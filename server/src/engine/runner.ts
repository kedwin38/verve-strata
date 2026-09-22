/**
 * Stratigraphy runner — orchestrates one full analysis:
 *
 *   1. resolve repo + manifest path (npm package.json, else requirements.txt)
 *   2. walk the manifest's commit history (capped depth) and rebuild the
 *      dependency snapshot at every revision that touched it
 *   3. diff snapshots → deposition events + per-dependency introductions
 *   4. resolve exact versions (lockfile, else today's range resolution)
 *   5. join live registry metadata + OSV vulnerability intelligence
 *   6. sample import usage across source files (blast radius)
 *   7. score: exposure-days, per-dep risk, repo index; emit findings
 *
 * Every upstream failure is recorded and the run continues — a degraded
 * analysis is more useful than a failed one, and the degradation is reported.
 */
import { env } from '../config.js';
import { q } from '../db.js';
import { logger } from '../logger.js';
import { decryptSecret } from '../crypto.js';
import * as github from '../services/github.js';
import { registryMeta, representativeVersion, type Ecosystem, type RegistryMeta } from '../services/registry.js';
import { osvQuery, mapVuln, type MappedVuln } from '../services/osv.js';
import { mapLimit } from '../services/httpfetch.js';
import {
  parsePackageJson, parseRequirementsTxt, parsePackageLock,
  type ManifestSnapshot,
} from './manifests.js';
import { diffSnapshots } from './depositions.js';
import { isSourceFile, prioritizeFiles, scanJsImports, scanPyImports } from './imports.js';
import { exposureForVulns, riskIndex, repoRiskIndex, SEVERITY_WEIGHT } from './scoring.js';

interface ProgressEntry { t: string; phase: string; msg: string }

async function progress(id: string, phase: string, msg: string) {
  await q(
    `update analyses set progress = progress || $2::jsonb where id = $1`,
    [id, JSON.stringify([{ t: new Date().toISOString(), phase, msg }])],
  );
}

async function markDegraded(id: string, note: string) {
  await q(
    `update analyses set degraded = degraded || $2::jsonb where id = $1`,
    [id, JSON.stringify([note])],
  );
}

export async function runAnalysis(analysisId: string, userId: string): Promise<void> {
  const claim = await q(
    `update analyses set status = 'running' where id = $1 and status = 'queued' returning owner, repo`,
    [analysisId],
  );
  if (!claim.rowCount) return;
  const { owner, repo } = claim.rows[0];

  try {
    // user PAT (encrypted at rest) raises rate limits; optional
    let userToken: string | null = null;
    const tok = await q('select ciphertext, nonce from gh_tokens where user_id = $1', [userId]);
    if (tok.rows[0] && env.TOKEN_ENC_KEY) {
      try {
        userToken = decryptSecret(tok.rows[0].ciphertext, tok.rows[0].nonce);
      } catch { /* stale key — proceed server-tokened */ }
    }

    await progress(analysisId, 'repo', `resolving ${owner}/${repo}`);
    const meta = await github.repoMeta(owner, repo, userToken);
    const branch = meta.default_branch;

    const headPkg = await github.contentAt(owner, repo, branch, 'package.json', userToken);
    const headReq = headPkg ? null : await github.contentAt(owner, repo, branch, 'requirements.txt', userToken);
    if (!headPkg && !headReq) {
      throw new Error('no package.json or requirements.txt at repository root');
    }
    const manifestPath = headPkg ? 'package.json' : 'requirements.txt';
    const ecosystem: Ecosystem = headPkg ? 'npm' : 'pypi';
    await q('update analyses set branch = $2, ecosystem = $3 where id = $1', [analysisId, branch, ecosystem]);

    // 2 — history of the manifest itself
    await progress(analysisId, 'history', `walking commit history of ${manifestPath}`);
    const commits = await github.commitsTouching(owner, repo, branch, manifestPath, 100, userToken);
    const window = commits.slice(0, env.STRATA_MAX_DEPTH).reverse(); // oldest → newest
    const truncated = commits.length > window.length;

    // 3 — snapshot per revision
    const snapshots: ManifestSnapshot[] = [];
    const settled = await mapLimit(window, 4, async (c) => {
      const file = await github.contentAt(owner, repo, c.sha, manifestPath, userToken);
      if (!file) return null;
      const deps = ecosystem === 'npm'
        ? parsePackageJson(file.content)?.deps ?? null
        : parseRequirementsTxt(file.content);
      if (!deps) return null;
      const snap: ManifestSnapshot = {
        sha: c.sha, committedAt: c.date, author: c.author,
        message: c.message, ecosystem, path: manifestPath, deps,
      };
      return snap;
    });
    for (const s of settled) if (s.status === 'fulfilled' && s.value) snapshots.push(s.value);
    snapshots.sort((a, b) => new Date(a.committedAt).getTime() - new Date(b.committedAt).getTime());

    await progress(analysisId, 'history', `${snapshots.length} manifest revisions reconstructed${truncated ? ' (window truncated at depth cap)' : ''}`);

    const { events, introductions } = diffSnapshots(snapshots);

    // 4 — current direct dependencies
    const head = snapshots[snapshots.length - 1];
    const currentDeps = [...head.deps.values()];
    await progress(analysisId, 'correlate', `${currentDeps.length} direct dependencies at HEAD`);

    // lockfile pins when available
    let pins = new Map<string, string>();
    if (ecosystem === 'npm') {
      const lock = await github.contentAt(owner, repo, branch, 'package-lock.json', userToken);
      if (lock) {
        pins = parsePackageLock(lock.content);
        await progress(analysisId, 'correlate', `lockfile parsed: ${pins.size} exact pins`);
      }
    }

    // 5 — registry + OSV join
    await progress(analysisId, 'intel', 'joining registry metadata and OSV intelligence');
    interface Enriched {
      dep: typeof currentDeps[number];
      meta: RegistryMeta | null;
      resolved: string | null;
      resolvedHow: 'lockfile' | 'range' | null;
      vulns: MappedVuln[];
      error?: string;
    }
    const enriched: Enriched[] = [];
    const intel = await mapLimit(currentDeps, 4, async (dep): Promise<Enriched> => {
      try {
        const meta = await registryMeta(ecosystem, dep.name);
        let resolved = pins.get(dep.name) ?? null;
        let resolvedHow: 'lockfile' | 'range' | null = resolved ? 'lockfile' : null;
        if (!resolved) {
          resolved = representativeVersion(meta, dep.range);
          resolvedHow = resolved ? 'range' : null;
        }
        let vulns: MappedVuln[] = [];
        if (resolved) {
          const raw = await osvQuery(ecosystem, dep.name, resolved);
          vulns = raw.map((v) => mapVuln(v, resolved!));
        }
        return { dep, meta, resolved, resolvedHow, vulns };
      } catch (err: any) {
        return { dep, meta: null, resolved: pins.get(dep.name) ?? null, resolvedHow: null, vulns: [], error: String(err?.message ?? err) };
      }
    });
    for (const r of intel) {
      enriched.push(r.status === 'fulfilled' ? r.value : { dep: (r as any).reason?.dep ?? { name: '?', range: null, kind: 'prod' }, meta: null, resolved: null, resolvedHow: null, vulns: [], error: String((r as any).reason) });
    }
    const degradedNotes = enriched.filter((e) => e.error).map((e) => `${e.dep.name}: ${e.error}`);
    for (const n of degradedNotes.slice(0, 10)) await markDegraded(analysisId, n);

    // 6 — usage breadth
    await progress(analysisId, 'usage', 'sampling import usage');
    const tree = await github.repoTree(owner, repo, branch, userToken);
    const sourceFiles = tree.filter((t) => t.type === 'blob' && isSourceFile(t.path)).map((t) => t.path);
    const sample = prioritizeFiles(sourceFiles, env.STRATA_IMPORT_SAMPLE);
    const usage = new Map<string, string[]>();
    const blobs = await mapLimit(sample, 4, async (path) => {
      const file = await github.contentAt(owner, repo, branch, path, userToken);
      return { path, content: file?.content ?? '' };
    });
    let sampledCount = 0;
    for (const b of blobs) {
      if (b.status !== 'fulfilled' || !b.value.content) continue;
      sampledCount++;
      const refs = ecosystem === 'npm' ? scanJsImports(b.value.content) : scanPyImports(b.value.content);
      for (const ref of refs) {
        const list = usage.get(ref) ?? [];
        list.push(b.value.path);
        usage.set(ref, list);
      }
    }
    await progress(analysisId, 'usage', `${sampledCount}/${sourceFiles.length} source files sampled`);

    // 7 — score + persist
    await progress(analysisId, 'score', 'computing exposure-days and risk indices');
    const now = new Date();

    // review-state lookup only for deps that carry vulns (bounded API spend)
    const needReview = enriched.filter((e) => e.vulns.length > 0).slice(0, 20);
    for (const e of needReview) {
      const intro = introductions.get(e.dep.name);
      if (intro?.prNumber) {
        const pr = await github.pullMeta(owner, repo, intro.prNumber, userToken).catch(() => null);
        if (pr) intro.reviewState = pr.approvals > 0;
      }
    }


    const persistedRisk: { risk: number; exposureDays: number }[] = [];

    for (const e of enriched) {
      const intro = introductions.get(e.dep.name) ?? null;
      const introducedAt = intro ? new Date(intro.at) : null;
      const { total: exposureDays } = exposureForVulns({
        vulns: e.vulns, introducedAt, now,
      });

      const latest = e.meta?.latest ?? null;
      const staleDays = e.resolved && latest && e.meta
        ? (new Date(e.meta.latestPublishedAt ?? now).getTime() -
           new Date(e.meta.times[e.resolved] ?? e.meta.times[latest] ?? now).getTime()) / 86_400_000
        : null;
      const deprecated = !!(e.resolved && e.meta?.deprecated[e.resolved]);
      const usageFiles = usage.get(e.dep.name) ?? [];
      const usageKey = ecosystem === 'npm' ? e.dep.name : e.dep.name.replace(/-/g, '_');
      const files = usageFiles.length ? usageFiles : usage.get(usageKey) ?? [];

      const reviewFlag = intro?.reviewState;
      const { risk, factors } = riskIndex({
        exposureDays, deprecated, staleDays,
        reviewed: reviewFlag === undefined ? null : reviewFlag,
        usageFileCount: files.length,
      });
      persistedRisk.push({ risk, exposureDays });

      await q(
        `insert into strata_records
          (analysis_id, name, ecosystem, dep_kind, constraint_range, resolved_version,
           introduced_at, introduced_commit, introduced_pr, introduced_author, reviewed,
           introduction_confidence, latest_version, latest_published_at, deprecated,
           usage_files, usage_sampled, vulns, exposure_days, risk, risk_factors)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          analysisId, e.dep.name, ecosystem, e.dep.kind, e.dep.range, e.resolved,
          introducedAt, intro?.commitSha ?? null, intro?.prNumber ?? null,
          intro?.author ?? null, reviewFlag === undefined ? null : reviewFlag,
          intro ? intro.confidence : 'unknown',
          latest, e.meta?.latestPublishedAt ?? null, deprecated,
          JSON.stringify(files.slice(0, 25)), sampledCount,
          JSON.stringify(e.vulns), Math.round(exposureDays * 10) / 10, risk,
          JSON.stringify(factors),
        ],
      );
    }

    // deposition events
    for (const ev of events) {
      await q(
        `insert into deposition_events
          (analysis_id, committed_at, kind, package, ecosystem, from_range, to_range,
           commit_sha, pr_number, author, reviewed)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [analysisId, ev.committedAt, ev.kind, ev.package, ev.ecosystem,
         ev.fromRange, ev.toRange, ev.commitSha, ev.prNumber, ev.author,
         introductions.get(ev.package)?.reviewState ?? null],
      );
    }

    // findings
    for (const e of enriched) {
      const intro = introductions.get(e.dep.name) ?? null;
      for (const v of e.vulns) {
        const start = intro ? new Date(intro.at) : null;
        const pub = v.published ? new Date(v.published) : null;
        const eff = start && pub ? (start > pub ? start : pub) : (start ?? pub);
        const days = eff ? Math.max(0, (now.getTime() - eff.getTime()) / 86_400_000) : 0;
        await q(
          `insert into findings (analysis_id, kind, package, severity, title, detail, exposure_days)
           values ($1,'vuln',$2,$3,$4,$5,$6)`,
          [analysisId, e.dep.name, v.severity,
           `${v.id}: ${v.summary}`,
           JSON.stringify({
             osvId: v.id, aliases: v.aliases, cvss: v.cvss, fixedIn: v.fixed_in,
             vulnerableRange: v.vulnerable_range, url: v.url,
             resolvedVersion: e.resolved, resolvedHow: e.resolvedHow,
             introducedBy: intro ? {
               commit: intro.commitSha, pr: intro.prNumber, author: intro.author,
               at: intro.at, confidence: intro.confidence,
             } : null,
             usageFiles: (usage.get(e.dep.name) ?? []).slice(0, 10),
           }),
           Math.round((SEVERITY_WEIGHT[v.severity] ?? 0.3) * days * 10) / 10],
        );
      }
      if (e.resolved && e.meta?.deprecated[e.resolved]) {
        await q(
          `insert into findings (analysis_id, kind, package, severity, title, detail, exposure_days)
           values ($1,'deprecated',$2,'moderate',$3,$4,0)`,
          [analysisId, e.dep.name,
           `${e.dep.name}@${e.resolved} is deprecated`,
           JSON.stringify({ message: e.meta.deprecated[e.resolved], latest: e.meta.latest })],
        );
      }
    }

    const stats = {
      deps: enriched.length,
      prodDeps: enriched.filter((e) => e.dep.kind === 'prod').length,
      events: events.length,
      revisions: snapshots.length,
      vulns: enriched.reduce((s, e) => s + e.vulns.length, 0),
      criticalVulns: enriched.reduce((s, e) => s + e.vulns.filter((v) => v.severity === 'critical').length, 0),
      usageSampled: sampledCount,
      degradedCount: degradedNotes.length,
      ...repoRiskIndex(persistedRisk),
    };
    await q(
      `update analyses set status = 'complete', stats = $2, truncated = $3,
       completed_at = now(), error = null where id = $1`,
      [analysisId, JSON.stringify(stats), truncated],
    );
    await progress(analysisId, 'done', `analysis complete — ${stats.deps} deps, ${stats.events} deposition events, ${stats.vulns} vulns, ${stats.totalExposureDays} exposure-days`);
    logger.info({ analysisId, stats }, 'analysis complete');
  } catch (err: any) {
    logger.error({ analysisId, err: err?.message, stack: err?.stack }, 'analysis failed');
    await q(
      `update analyses set status = 'failed', error = $2, completed_at = now() where id = $1`,
      [analysisId, String(err?.message ?? err).slice(0, 500)],
    );
  }
}
