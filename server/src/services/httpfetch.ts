import { env } from '../config.js';
import { q } from '../db.js';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Skip the DB cache entirely (used for auth-sensitive calls). */
  noStore?: boolean;
  /** Cache TTL in seconds for 200 responses without etag. */
  ttlSeconds?: number;
  timeoutMs?: number;
}

interface CacheRow {
  etag: string | null;
  status: number;
  body: string;
  fetched_at: Date;
}

const DEFAULT_TTL = 6 * 60 * 60; // 6h: registry/vuln data changes slowly

/**
 * DB-backed conditional fetch. Revalidates with If-None-Match when we hold an
 * etag, so repeat analyses cost the upstream nothing beyond 304s. This is what
 * lets Strata live inside unauthenticated GitHub rate limits.
 */
export async function cachedFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<{ status: number; body: string; fromCache: boolean }> {
  const { headers = {}, method = 'GET', body, noStore = false, ttlSeconds = DEFAULT_TTL, timeoutMs = 15_000 } = opts;

  if (!noStore && method === 'GET') {
    const cached = await q<CacheRow>(
      'select etag, status, body, fetched_at from fetch_cache where url = $1',
      [url],
    );
    const row = cached.rows[0];
    if (row) {
      const fresh =
        row.etag ||
        Date.now() - new Date(row.fetched_at).getTime() < ttlSeconds * 1000;
      if (fresh && row.status === 200) {
        return { status: 200, body: row.body, fromCache: true };
      }
    }

    const condHeaders = { ...headers };
    if (row?.etag) condHeaders['If-None-Match'] = row.etag;
    const res = await rawFetch(url, condHeaders, method, body, timeoutMs);
    if (res.status === 304 && row) {
      await q('update fetch_cache set fetched_at = now() where url = $1', [url]);
      return { status: row.status, body: row.body, fromCache: true };
    }
    await store(url, res.status, res.body, res.headers);
    return { status: res.status, body: res.body, fromCache: false };
  }

  const res = await rawFetch(url, headers, method, body, timeoutMs);
  if (!noStore && method === 'GET' && res.status === 200) {
    await store(url, res.status, res.body, res.headers);
  }
  return { status: res.status, body: res.body, fromCache: false };
}

function store(url: string, status: number, body: string, headers: Headers) {
  const etag = headers.get('etag');
  return q(
    `insert into fetch_cache (url, etag, status, body, fetched_at)
     values ($1, $2, $3, $4, now())
     on conflict (url) do update
       set etag = excluded.etag, status = excluded.status,
           body = excluded.body, fetched_at = now()`,
    [url, etag, status, body],
  ).catch((err) => logger.warn({ err, url }, 'fetch_cache store failed'));
}

async function rawFetch(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'POST',
  body: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; body: string; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 403 || res.status === 429) {
      // GitHub uses 403 for rate-limit exhaustion; surface a clear signal.
      const hit = text.includes('rate limit') || res.headers.get('x-ratelimit-remaining') === '0';
      if (hit) logger.warn({ url }, 'upstream rate limit hit');
    }
    return { status: res.status, body: text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** Run async work with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Prefer a user token, then the optional server token, then anonymous. */
export function githubAuthHeader(userToken?: string | null): Record<string, string> {
  const token = userToken || env.GITHUB_TOKEN || '';
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'verve-strata/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
