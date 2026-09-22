import { cachedFetch } from './httpfetch.js';
import type { Ecosystem } from './registry.js';

const OSV = 'https://api.osv.dev/v1';

export interface OsvEvent { introduced?: string; fixed?: string; last_affected?: string }
export interface OsvRange { type: string; repo?: string; events: OsvEvent[] }
export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  affected?: {
    package?: { ecosystem: string; name: string };
    ranges?: OsvRange[];
    ecosystem_specific?: { severity?: string };
    database_specific?: { severity?: string };
  }[];
  database_specific?: { severity?: string };
  references?: { type: string; url: string }[];
}

export interface MappedVuln {
  id: string;
  aliases: string[];
  summary: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  cvss: number | null;
  published: string | null;
  fixed_in: string | null;
  url: string;
  vulnerable_range: string;
}

/** Query OSV for all vulns affecting `name@version` in an ecosystem. */
export async function osvQuery(
  ecosystem: Ecosystem, name: string, version: string,
): Promise<OsvVuln[]> {
  const { status, body } = await cachedFetch(`${OSV}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      package: { ecosystem: ecosystem === 'npm' ? 'npm' : 'PyPI', name },
      version,
    }),
  });
  if (status !== 200) return [];
  const parsed = JSON.parse(body);
  return (parsed.vulns ?? []) as OsvVuln[];
}

/** Map an OSV record onto Strata's normalized vuln shape. */
export function mapVuln(v: OsvVuln, version: string): MappedVuln {
  return {
    id: v.id,
    aliases: v.aliases ?? [],
    summary: v.summary ?? v.details?.slice(0, 140) ?? 'No summary provided',
    severity: severityClass(v),
    cvss: cvssScore(v),
    published: v.published ?? null,
    fixed_in: fixedInFor(v, version),
    url: `https://osv.dev/vulnerability/${v.id}`,
    vulnerable_range: humanRange(v),
  };
}

export function severityClass(v: OsvVuln): MappedVuln['severity'] {
  const label =
    v.database_specific?.severity ??
    v.affected?.[0]?.ecosystem_specific?.severity ??
    v.affected?.[0]?.database_specific?.severity ??
    '';
  const byLabel = String(label).toLowerCase();
  if (byLabel.includes('crit')) return 'critical';
  if (byLabel.includes('high')) return 'high';
  if (byLabel.includes('mod') || byLabel.includes('med')) return 'moderate';
  if (byLabel.includes('low')) return 'low';

  const score = cvssScore(v);
  if (score === null) return 'moderate'; // unknown → treated as moderate, flagged
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'moderate';
  return 'low';
}

export function cvssScore(v: OsvVuln): number | null {
  for (const s of v.severity ?? []) {
    if (s.type.startsWith('CVSS')) {
      // OSV delivers either a bare numeric score ("9.8") or a full vector
      // string; only the numeric form carries an extractable value.
      const n = Number(s.score);
      if (!Number.isNaN(n) && s.score.trim() !== '') return n;
      const m = s.score.match(/CVSS:[^/]+\/[^/]+:([0-9.]+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** Smallest SEMVER `fixed` event strictly greater than `version`. */
export function fixedInFor(v: OsvVuln, version: string): string | null {
  const candidates: string[] = [];
  for (const aff of v.affected ?? []) {
    for (const range of aff.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      for (const ev of range.events) {
        if (ev.fixed) candidates.push(ev.fixed);
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(compareLoose);
  for (const c of candidates) {
    if (compareLoose(c, version) > 0) return c;
  }
  return null;
}

function humanRange(v: OsvVuln): string {
  const parts: string[] = [];
  for (const aff of v.affected ?? []) {
    for (const range of aff.ranges ?? []) {
      const intro = range.events.find((e) => e.introduced)?.introduced ?? '0';
      const fixed = range.events.find((e) => e.fixed)?.fixed;
      const last = range.events.find((e) => e.last_affected)?.last_affected;
      parts.push(fixed ? `>= ${intro} < ${fixed}` : last ? `>= ${intro} <= ${last}` : `>= ${intro}`);
    }
  }
  return parts.join(' | ') || 'unknown';
}

export function compareLoose(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
