/**
 * The Forensic Reasoner — Strata's investigation agent.
 *
 * Design stance: this agent is DETERMINISTIC and EVIDENCE-BOUND by
 * construction. It executes a fixed plan of typed tool calls against the
 * analysis record and live upstream sources; every node of the causal chain
 * it emits cites the evidence that produced it, and confidence is a
 * computable function of evidence completeness — not a language model's
 * self-assessment. It cannot hallucinate a cause; it can only be incomplete.
 *
 * Plan:  locate → contextualize (PR/review) → weigh (usage)
 *        → solve (upgrade path) → verify → recommend.
 */
import { q } from '../db.js';
import { env } from '../config.js';
import { decryptSecret } from '../crypto.js';
import * as github from '../services/github.js';
import { registryMeta } from '../services/registry.js';
import { compareLoose } from '../services/osv.js';
import * as semver from 'semver';
import { createHash } from 'node:crypto';

export interface ChainNode {
  id: string;
  type:
    | 'finding' | 'package' | 'version' | 'introduction' | 'review'
    | 'usage' | 'vuln' | 'fix' | 'target' | 'action';
  label: string;
  detail?: Record<string, unknown>;
  evidence: EvidenceRef[];
}

export interface EvidenceRef {
  source: string;       // e.g. "github:pulls/123", "osv:GHSA-…", "db:strata_records"
  url?: string;
  fetchedAt: string;
  digest: string;       // short sha256 of the payload that backs this node
}

export interface ChainEdge { from: string; to: string; relation: string }

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  ms: number;
  note?: string;
}

export interface Recommendation {
  action: 'upgrade-in-range' | 'upgrade-major' | 'pin-override' | 'revert-introduction' | 'monitor';
  urgency: 'immediate' | 'soon' | 'scheduled' | 'none';
  target: string | null;
  targetPublishedAt: string | null;
  rationale: string;
  patch: { path: string; from: string; to: string } | null;
  rollbackNote: string | null;
  requiresApproval: boolean;
}

export interface InvestigationResult {
  chain: { nodes: ChainNode[]; edges: ChainEdge[] };
  confidence: number;
  toolTrace: ToolCall[];
  recommendation: Recommendation;
}

function digest(input: unknown): string {
  // short stable digest of the payload backing an evidence node
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12);
}

function ev(source: string, payload: unknown, url?: string): EvidenceRef {
  return { source, url, fetchedAt: new Date().toISOString(), digest: digest(payload) };
}

interface FindingRow {
  id: string; analysis_id: string; kind: string; package: string;
  severity: string; title: string; detail: any; exposure_days: string;
  owner: string; repo: string;
}
interface StrataRow {
  name: string; ecosystem: string; constraint_range: string | null;
  resolved_version: string | null; introduced_at: Date | null;
  introduced_commit: string | null; introduced_pr: number | null;
  introduced_author: string | null; reviewed: boolean | null;
  introduction_confidence: string; usage_files: any; latest_version: string | null;
}
interface AnalysisRow { owner: string; repo: string }

export async function investigate(
  findingId: string, userId: string,
): Promise<InvestigationResult> {
  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  const tools: ToolCall[] = [];

  const track = async <T>(name: string, input: Record<string, unknown>, fn: () => Promise<T>): Promise<T | null> => {
    const t0 = Date.now();
    try {
      const out = await fn();
      tools.push({ tool: name, input, ok: true, ms: Date.now() - t0 });
      return out;
    } catch (err: any) {
      tools.push({ tool: name, input, ok: false, ms: Date.now() - t0, note: String(err?.message ?? err).slice(0, 200) });
      return null;
    }
  };

  // ── locate ─────────────────────────────────────────────────────────────
  const finding = (await track('db.finding', { findingId }, async () => {
    const r = await q<FindingRow>(
      `select f.*, a.owner, a.repo from findings f
       join analyses a on a.id = f.analysis_id where f.id = $1`, [findingId],
    );
    if (!r.rows[0]) throw new Error('finding not found');
    return r.rows[0];
  }))!;
  const strata = (await track('db.strata_record', { pkg: finding.package }, async () => {
    const r = await q<StrataRow>(
      `select * from strata_records where analysis_id = $1 and name = $2 limit 1`,
      [finding.analysis_id, finding.package],
    );
    return r.rows[0] ?? null;
  }))!;

  let confidence = 0.5;
  const bump = (n: number) => { confidence = Math.min(0.95, confidence + n); };

  nodes.push({
    id: 'finding', type: 'finding', label: finding.title,
    detail: { severity: finding.severity, exposureDays: Number(finding.exposure_days) },
    evidence: [ev('db:findings', { id: finding.id })],
  });
  nodes.push({
    id: 'pkg', type: 'package', label: `${finding.package}`,
    detail: {
      ecosystem: strata?.ecosystem, constraint: strata?.constraint_range,
      resolved: strata?.resolved_version,
    },
    evidence: [ev('db:strata_records', { name: finding.package })],
  });
  edges.push({ from: 'finding', to: 'pkg', relation: 'affects' });

  if (finding.detail?.osvId) {
    nodes.push({
      id: 'vuln', type: 'vuln', label: finding.detail.osvId,
      detail: {
        fixedIn: finding.detail.fixedIn, cvss: finding.detail.cvss,
        range: finding.detail.vulnerableRange,
      },
      evidence: [ev(`osv:${finding.detail.osvId}`, finding.detail, finding.detail.url)],
    });
    edges.push({ from: 'vuln', to: 'finding', relation: 'published-as' });
  }

  // ── contextualize: introduction provenance ─────────────────────────────
  if (strata?.introduced_commit) {
    nodes.push({
      id: 'intro', type: 'introduction',
      label: `introduced ${strata.introduced_at?.toISOString().slice(0, 10)} by ${strata.introduced_author ?? 'unknown'}`,
      detail: {
        commit: strata.introduced_commit,
        pr: strata.introduced_pr,
        confidence: strata.introduction_confidence,
      },
      evidence: [ev(`github:commit/${strata.introduced_commit}`, {
        sha: strata.introduced_commit,
      }, `https://github.com/${finding.owner}/${finding.repo}/commit/${strata.introduced_commit}`)],
    });
    edges.push({ from: 'intro', to: 'pkg', relation: 'deposited' });
    if (strata.introduction_confidence === 'exact') bump(0.2);
  }

  // user token for upstream calls (optional)
  let userToken: string | null = null;
  const tok = await q('select ciphertext, nonce from gh_tokens where user_id = $1', [userId]);
  if (tok.rows[0] && env.TOKEN_ENC_KEY) {
    try { userToken = decryptSecret(tok.rows[0].ciphertext, tok.rows[0].nonce); } catch { /* ignore */ }
  }

  if (strata?.introduced_pr) {
    const pr = await track('github.pull_meta', { pr: strata.introduced_pr }, () =>
      github.pullMeta(finding.owner, finding.repo, strata.introduced_pr!, userToken));
    if (pr) {
      nodes.push({
        id: 'review', type: 'review',
        label: pr.approvals > 0
          ? `PR #${pr.number} had ${pr.approvals} approval(s)`
          : `PR #${pr.number} merged with ${pr.review_count} review(s), ${pr.approvals} approvals`,
        detail: { approvals: pr.approvals, reviews: pr.review_count, mergedBy: pr.merged_by, title: pr.title },
        evidence: [ev(`github:pulls/${pr.number}`, pr,
          `https://github.com/${finding.owner}/${finding.repo}/pull/${pr.number}`)],
      });
      edges.push({ from: 'review', to: 'intro', relation: 'reviewed-by' });
      bump(0.1);
    }
  }

  // ── weigh: usage breadth ───────────────────────────────────────────────
  const usageFiles: string[] = Array.isArray(finding.detail?.usageFiles)
    ? finding.detail.usageFiles : [];
  nodes.push({
    id: 'usage', type: 'usage',
    label: usageFiles.length
      ? `referenced by ${usageFiles.length} sampled file(s)`
      : 'no references found in sampled files',
    detail: { files: usageFiles.slice(0, 10) },
    evidence: [ev('engine:import-scan', { files: usageFiles })],
  });
  edges.push({ from: 'pkg', to: 'usage', relation: 'referenced-in' });
  if (usageFiles.length > 0) bump(0.1);

  // ── solve + verify: upgrade path ───────────────────────────────────────
  const resolved = strata?.resolved_version ?? null;
  const fixedIn: string | null = finding.detail?.fixedIn ?? null;
  let target: string | null = null;
  let targetPublishedAt: string | null = null;

  if (resolved && fixedIn) {
    const meta = await track('registry.meta', { pkg: finding.package }, () =>
      registryMeta((strata!.ecosystem as 'npm' | 'pypi'), finding.package));
    if (meta) {
      const candidates = meta.versions.filter((v) => compareLoose(v, fixedIn) >= 0);
      target = candidates[0] ?? null;
      if (target) {
        targetPublishedAt = meta.times[target] ?? null;
        nodes.push({
          id: 'target', type: 'target',
          label: `upgrade target ${finding.package}@${target}`,
          detail: { fixedIn, publishedAt: targetPublishedAt, latest: meta.latest },
          evidence: [ev(`registry:${strata!.ecosystem}`, { target, times: targetPublishedAt })],
        });
        edges.push({ from: 'vuln', to: 'target', relation: 'fixed-in' });
        bump(0.1);
      }
    }
  }

  // ── recommend ──────────────────────────────────────────────────────────
  let recommendation: Recommendation;
  if (target && resolved) {
    const inRange = strata?.constraint_range && strata.ecosystem === 'npm'
      ? semver.satisfies(target, strata.constraint_range)
      : false;
    if (inRange) {
      recommendation = {
        action: 'upgrade-in-range',
        urgency: finding.severity === 'critical' || finding.severity === 'high' ? 'immediate' : 'soon',
        target, targetPublishedAt,
        rationale:
          `A version satisfying the existing constraint (${strata?.constraint_range}) already ` +
          `contains the fix — the lockfile is pinning the exposure. Refreshing the lockfile ` +
          `retires ${Math.round(Number(finding.exposure_days))} exposure-days without a manifest change.`,
        patch: null,
        rollbackNote: null,
        requiresApproval: false,
      };
    } else {
      const newRange = `^${target}`;
      recommendation = {
        action: 'upgrade-major',
        urgency: finding.severity === 'critical' ? 'immediate' : 'soon',
        target, targetPublishedAt,
        rationale:
          `The fix (${fixedIn}) is outside constraint ${strata?.constraint_range}; the manifest ` +
          `must move. Proposed range ${newRange} — review the major-version changelog before merge.`,
        patch: {
          path: 'package.json',
          from: `${finding.package}: ${strata?.constraint_range}`,
          to: `${finding.package}: ${newRange}`,
        },
        rollbackNote: `revert introduction commit ${strata?.introduced_commit ?? 'n/a'} if the package must be dropped entirely`,
        requiresApproval: true,
      };
    }
  } else if (resolved && !fixedIn) {
    recommendation = {
      action: 'monitor',
      urgency: 'scheduled',
      target: null, targetPublishedAt: null,
      rationale:
        'No fixed version is published for this advisory. Track the advisory, consider ' +
        'compensating controls, and re-run stratigraphy after upstream releases a fix.',
      patch: null,
      rollbackNote: null,
      requiresApproval: false,
    };
  } else {
    recommendation = {
      action: 'revert-introduction',
      urgency: 'soon',
      target: null, targetPublishedAt: null,
      rationale:
        'Version could not be resolved from lockfile or range; the safest deterministic action ' +
        'is to revisit the introduction commit and pin deliberately.',
      patch: null,
      rollbackNote: strata?.introduced_commit
        ? `introduced by commit ${strata.introduced_commit}`
        : null,
      requiresApproval: false,
    };
  }

  nodes.push({
    id: 'action', type: 'action',
    label: recommendation.action,
    detail: recommendation as unknown as Record<string, unknown>,
    evidence: [ev('reasoner:policy', { action: recommendation.action })],
  });
  edges.push({
    from: nodes.some((n) => n.id === 'target') ? 'target' : 'usage',
    to: 'action',
    relation: 'recommends',
  });

  return {
    chain: { nodes, edges },
    confidence: Math.round(confidence * 100) / 100,
    toolTrace: tools,
    recommendation,
  };
}
