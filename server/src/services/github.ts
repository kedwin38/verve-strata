import { cachedFetch, githubAuthHeader, HttpError } from './httpfetch.js';

const API = 'https://api.github.com';

export interface RepoMeta {
  full_name: string;
  default_branch: string;
  pushed_at: string | null;
  stargazers_count: number;
  archived: boolean;
}

export interface CommitLite {
  sha: string;
  date: string;          // commit (not author) date — the deposition instant
  author: string;        // login or name
  message: string;
}

export interface ContentFile {
  path: string;
  content: string;       // decoded utf8
  size: number;
}

export interface TreeEntry {
  path: string;
  sha?: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface PullMeta {
  number: number;
  title: string;
  merged_at: string | null;
  merged_by: string | null;
  user: string;
  head_sha: string;
  base_sha: string;
  review_count: number;
  approvals: number;
}

async function ghJson<T>(
  url: string,
  userToken?: string | null,
): Promise<T> {
  const { status, body } = await cachedFetch(url, {
    headers: githubAuthHeader(userToken),
  });
  if (status === 404) throw new HttpError(404, url, body);
  if (status === 403 || status === 429) throw new HttpError(status, url, body);
  if (status !== 200) throw new HttpError(status, url, body);
  return JSON.parse(body) as T;
}

export function repoMeta(owner: string, repo: string, token?: string | null) {
  return ghJson<RepoMeta>(`${API}/repos/${owner}/${repo}`, token);
}

/** Commits that touched a path, newest first. */
export async function commitsTouching(
  owner: string, repo: string, branch: string, path: string,
  perPage = 100, token?: string | null,
): Promise<CommitLite[]> {
  const url =
    `${API}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}` +
    `&path=${encodeURIComponent(path)}&per_page=${perPage}`;
  const raw = await ghJson<any[]>(url, token);
  return raw.map((c) => ({
    sha: c.sha,
    date: c.commit.committer?.date ?? c.commit.author?.date ?? '',
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    message: c.commit.message ?? '',
  }));
}

export async function contentAt(
  owner: string, repo: string, ref: string, path: string,
  token?: string | null,
): Promise<ContentFile | null> {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  try {
    const raw = await ghJson<any>(url, token);
    if (Array.isArray(raw) || raw.type !== 'file') return null;
    return {
      path,
      content: Buffer.from(raw.content, 'base64').toString('utf8'),
      size: raw.size ?? 0,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export async function repoTree(
  owner: string, repo: string, ref: string, token?: string | null,
): Promise<TreeEntry[]> {
  const url = `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  try {
    const raw = await ghJson<any>(url, token);
    return (raw.tree ?? []) as TreeEntry[];
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

export async function blob(
  owner: string, repo: string, sha: string, token?: string | null,
): Promise<string> {
  const url = `${API}/repos/${owner}/${repo}/git/blobs/${sha}`;
  const raw = await ghJson<any>(url, token);
  return Buffer.from(raw.content, raw.encoding ?? 'base64').toString('utf8');
}

export async function pullMeta(
  owner: string, repo: string, number: number, token?: string | null,
): Promise<PullMeta | null> {
  try {
    const pr = await ghJson<any>(
      `${API}/repos/${owner}/${repo}/pulls/${number}`, token,
    );
    let review_count = 0, approvals = 0;
    try {
      const reviews = await ghJson<any[]>(
        `${API}/repos/${owner}/${repo}/pulls/${number}/reviews`, token,
      );
      review_count = reviews.length;
      approvals = reviews.filter((r) => r.state === 'APPROVED').length;
    } catch {
      /* reviews are best-effort */
    }
    return {
      number: pr.number,
      title: pr.title ?? '',
      merged_at: pr.merged_at,
      merged_by: pr.merged_by?.login ?? null,
      user: pr.user?.login ?? 'unknown',
      head_sha: pr.head?.sha ?? '',
      base_sha: pr.base?.sha ?? '',
      review_count,
      approvals,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** Extract a PR number from a merge-commit message like "Merge pull request #123 …". */
export function prFromMessage(message: string): number | null {
  const m = message.match(/#(\d+)/);
  if (/merge (pull request|branch|remote-tracking)/i.test(message) && m) return Number(m[1]);
  if (m && /\(#\d+\)\s*$/m.test(message)) return Number(m[1]); // squash-style "(#123)"
  return null;
}
