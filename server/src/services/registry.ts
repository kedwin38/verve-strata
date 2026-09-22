import { cachedFetch } from './httpfetch.js';
import * as semver from 'semver';

export type Ecosystem = 'npm' | 'pypi';

export interface RegistryMeta {
  ecosystem: Ecosystem;
  latest: string | null;
  latestPublishedAt: string | null;
  /** publish date per exact version */
  times: Record<string, string>;
  /** versions that exist (stable, no prerelease for npm) */
  versions: string[];
  /** deprecation message keyed by exact version */
  deprecated: Record<string, string>;
}

export async function npmMeta(name: string): Promise<RegistryMeta> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`;
  const { status, body } = await cachedFetch(url, {
    headers: { Accept: 'application/vnd.npm.install-v1+json;q=0.9, application/json' },
  });
  if (status !== 200) throw new Error(`npm registry ${status} for ${name}`);
  const doc = JSON.parse(body);
  const versions: string[] = Object.keys(doc.versions ?? {})
    .filter((v) => semver.valid(v) && !semver.prerelease(v));
  const deprecated: Record<string, string> = {};
  for (const [v, meta] of Object.entries<any>(doc.versions ?? {})) {
    if (meta?.deprecated) deprecated[v] = String(meta.deprecated);
  }
  const times: Record<string, string> = {};
  for (const [v, t] of Object.entries<any>(doc.time ?? {})) {
    if (v !== 'created' && v !== 'modified') times[v] = String(t);
  }
  const latest = doc['dist-tags']?.latest ?? null;
  return {
    ecosystem: 'npm',
    latest,
    latestPublishedAt: latest ? times[latest] ?? null : null,
    times,
    versions,
    deprecated,
  };
}

export async function pypiMeta(name: string): Promise<RegistryMeta> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const { status, body } = await cachedFetch(url);
  if (status !== 200) throw new Error(`pypi ${status} for ${name}`);
  const doc = JSON.parse(body);
  const times: Record<string, string> = {};
  const versions: string[] = [];
  const sorted = Object.entries<any>(doc.releases ?? {})
    .filter(([v, files]) => Array.isArray(files) && files.length > 0);
  sorted.sort((a, b) => semver.compareBuild(coercePypi(a[0]), coercePypi(b[0])));
  for (const [v, files] of sorted) {
    const uploaded = files[0]?.upload_time_utc_iso_8601 ?? files[0]?.upload_time;
    if (uploaded) times[v] = String(uploaded).replace(' ', 'T') + (String(uploaded).endsWith('Z') ? '' : 'Z');
    versions.push(v);
  }
  return {
    ecosystem: 'pypi',
    latest: doc.info?.version ?? null,
    latestPublishedAt: times[doc.info?.version] ?? null,
    times,
    versions,
    deprecated: {},
  };
}

function coercePypi(v: string): string {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : `0.0.${versionsSeq++}`;
}
let versionsSeq = 0;

export async function registryMeta(
  ecosystem: Ecosystem, name: string,
): Promise<RegistryMeta> {
  return ecosystem === 'npm' ? npmMeta(name) : pypiMeta(name);
}

/**
 * The version a fresh `npm install` of `range` would resolve to today.
 * Used for OSV queries when no lockfile pins the exact version — the
 * assumption is recorded in the analysis output, never hidden.
 */
export function representativeVersion(meta: RegistryMeta, range: string | null): string | null {
  if (!range) {
    return meta.versions.length ? meta.versions[meta.versions.length - 1] : null;
  }
  if (meta.ecosystem === 'npm') {
    const max = semver.maxSatisfying(meta.versions, range);
    return max ?? null;
  }
  // pypi: best-effort exact pin
  const pin = range.match(/==\s*([^\s,;]+)/);
  if (pin) return pin[1];
  return meta.latest;
}
