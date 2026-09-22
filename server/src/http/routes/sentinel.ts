/**
 * Sentinel — the pre-merge gate. Given a pull request, reconstructs the
 * manifest states at base and head, diffs them, and evaluates what the merge
 * would deposit: new vulnerable dependencies (verdict: block), deprecated or
 * moderate-risk additions (warn), and exposure the PR retires (removed
 * vulnerable deps) — a dimension reviewers have never had.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../../db.js';
import { env } from '../../config.js';
import { decryptSecret } from '../../crypto.js';
import * as github from '../../services/github.js';
import { registryMeta, representativeVersion, type Ecosystem } from '../../services/registry.js';
import { osvQuery, mapVuln } from '../../services/osv.js';
import { parsePackageJson, parseRequirementsTxt, type ManifestSnapshot } from '../../engine/manifests.js';
import { diffPair } from '../../engine/depositions.js';
import { mapLimit } from '../../services/httpfetch.js';
import { rateLimit, audit } from '../ratelimit.js';

const Body = z.object({
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  pr: z.number().int().positive(),
});

interface VerdictItem {
  package: string;
  change: 'add' | 'remove' | 'bump';
  toRange: string | null;
  resolved: string | null;
  vulns: ReturnType<typeof mapVuln>[];
  deprecated: boolean;
}

export async function sentinelRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (sub) => {
    sub.addHook('preHandler', async (req, reply) => {
      if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    });

    sub.post('/sentinel', {
      preHandler: rateLimit({ name: 'sentinel', capacity: 12, refillPerMinute: 1 }),
    }, async (req, reply) => {
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: 'expected { repo: "owner/name", pr: number }' });
      }
      const [owner, repo] = parsed.data.repo.split('/');

      let userToken: string | null = null;
      const tok = await q('select ciphertext, nonce from gh_tokens where user_id = $1', [req.user!.id]);
      if (tok.rows[0] && env.TOKEN_ENC_KEY) {
        try { userToken = decryptSecret(tok.rows[0].ciphertext, tok.rows[0].nonce); } catch { /* ignore */ }
      }

      const pr = await github.pullMeta(owner, repo, parsed.data.pr, userToken).catch(() => null);
      if (!pr || !pr.head_sha || !pr.base_sha) {
        return reply.code(404).send({ error: 'pr_not_found', message: 'pull request not found or not accessible' });
      }

      // manifests at both refs
      const snapAt = async (ref: string): Promise<ManifestSnapshot | null> => {
        const pkg = await github.contentAt(owner, repo, ref, 'package.json', userToken);
        const ecosystem: Ecosystem = 'npm';
        if (pkg) {
          const deps = parsePackageJson(pkg.content)?.deps ?? null;
          if (!deps) return null;
          return { sha: ref, committedAt: '', author: '', message: '', ecosystem, path: 'package.json', deps };
        }
        const reqTxt = await github.contentAt(owner, repo, ref, 'requirements.txt', userToken);
        if (reqTxt) {
          return { sha: ref, committedAt: '', author: '', message: '', ecosystem: 'pypi', path: 'requirements.txt', deps: parseRequirementsTxt(reqTxt.content) };
        }
        return null;
      };
      const [base, head] = [await snapAt(pr.base_sha), await snapAt(pr.head_sha)];
      if (!base || !head) {
        return reply.code(422).send({ error: 'no_manifest', message: 'no root package.json/requirements.txt at either ref — nothing to gate' });
      }

      const events = diffPair(base, head);
      const touched = events.filter((e) => e.kind !== 'remove');
      const removed = events.filter((e) => e.kind === 'remove');

      const items: VerdictItem[] = [];
      const intel = await mapLimit(touched, 4, async (ev) => {
        try {
          const dep = head.deps.get(ev.package) ?? base.deps.get(ev.package);
          const ecosystem = head.ecosystem as Ecosystem;
          const meta = await registryMeta(ecosystem, ev.package);
          const resolved = representativeVersion(meta, dep?.range ?? ev.toRange);
          let vulns: ReturnType<typeof mapVuln>[] = [];
          if (resolved) {
            vulns = (await osvQuery(ecosystem, ev.package, resolved)).map((v) => mapVuln(v, resolved!));
          }
          const deprecated = !!(resolved && meta.deprecated[resolved]);
          return { package: ev.package, change: ev.kind, toRange: ev.toRange, resolved, vulns, deprecated } as VerdictItem;
        } catch {
          return {
            package: ev.package, change: ev.kind, toRange: ev.toRange,
            resolved: null, vulns: [], deprecated: false,
          } as VerdictItem;
        }
      });
      for (const r of intel) if (r.status === 'fulfilled') items.push(r.value);

      // risk retired by removals (best effort, current states)
      const retired: { package: string; vulns: number }[] = [];
      for (const ev of removed) {
        try {
          const ecosystem = base.ecosystem as Ecosystem;
          const meta = await registryMeta(ecosystem, ev.package);
          const resolved = representativeVersion(meta, ev.fromRange);
          if (resolved) {
            const vulns = await osvQuery(ecosystem, ev.package, resolved);
            if (vulns.length > 0) retired.push({ package: ev.package, vulns: vulns.length });
          }
        } catch { /* best effort */ }
      }

      const blocking = items.filter((i) =>
        i.vulns.some((v) => v.severity === 'critical' || v.severity === 'high'));
      const warning = items.filter((i) =>
        !blocking.includes(i) &&
        (i.vulns.length > 0 || i.deprecated));

      const verdict = blocking.length ? 'block' : warning.length ? 'warn' : (items.length || retired.length ? 'pass' : 'neutral');

      await audit(req.user!.id, 'sentinel.preview', `${owner}/${repo}#${parsed.data.pr}`, { verdict }, req.ip);
      return {
        pr: {
          number: pr.number, title: pr.title, approvals: pr.approvals,
          reviews: pr.review_count, author: pr.user,
          url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        },
        verdict,
        delta: items,
        retired,
        rationale: verdict === 'block'
          ? `${blocking.length} incoming change(s) introduce dependencies with critical/high advisories at their resolvable versions — merge would begin accruing exposure-days immediately`
          : verdict === 'warn'
          ? `${warning.length} incoming change(s) carry moderate advisories or deprecations — review before merge`
          : verdict === 'pass'
          ? 'incoming dependency changes introduce no known advisories at resolvable versions'
          : 'no dependency manifest changes in this pull request',
      };
    });
  }, { prefix: '' });
}
