import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../../db.js';
import { env } from '../../config.js';
import { decryptSecret } from '../../crypto.js';
import { investigate } from '../../agent/reasoner.js';
import { githubAuthHeader } from '../../services/httpfetch.js';
import { rateLimit, audit } from '../ratelimit.js';

/**
 * Investigation endpoints: run the forensic reasoner on a finding, read the
 * causal chain, and (explicitly gated) apply a remediation as a real pull
 * request using the user's stored GitHub token.
 */

export async function investigationRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (sub) => {
    sub.addHook('preHandler', async (req, reply) => {
      if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    });

    sub.post('/findings/:id/investigate', {
      preHandler: rateLimit({ name: 'investigate', capacity: 20, refillPerMinute: 2 }),
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const own = await q(
        `select f.id from findings f join analyses a on a.id = f.analysis_id
         where f.id = $1 and a.user_id = $2`,
        [id, req.user!.id],
      );
      if (!own.rowCount) return reply.code(404).send({ error: 'not_found' });

      const result = await investigate(id, req.user!.id);
      const existing = await q(
        'select id from investigations where finding_id = $1 order by created_at desc limit 1',
        [id],
      );
      let investigationId: string;
      if (existing.rows[0]) {
        investigationId = existing.rows[0].id;
        await q(
          `update investigations set confidence = $2, chain = $3, tool_trace = $4,
             recommendation = $5, created_at = now() where id = $1`,
          [investigationId, result.confidence, JSON.stringify(result.chain),
           JSON.stringify(result.toolTrace), JSON.stringify(result.recommendation)],
        );
      } else {
        const ins = await q<{ id: string }>(
          `insert into investigations (user_id, finding_id, confidence, chain, tool_trace, recommendation)
           values ($1,$2,$3,$4,$5,$6) returning id`,
          [req.user!.id, id, result.confidence, JSON.stringify(result.chain),
           JSON.stringify(result.toolTrace), JSON.stringify(result.recommendation)],
        );
        investigationId = ins.rows[0].id;
      }
      await audit(req.user!.id, 'investigation.run', id, { confidence: result.confidence }, req.ip);
      return reply.code(201).send({ id: investigationId, ...result });
    });

    sub.get('/investigations/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await q(
        `select i.* from investigations i where i.id = $1 and i.user_id = $2`,
        [id, req.user!.id],
      );
      if (!rows.rows[0]) return reply.code(404).send({ error: 'not_found' });
      return rows.rows[0];
    });

    /**
     * APPROVAL GATE — the only write path to the outside world.
     * Requires: explicit user click (this call), a stored PAT, a
     * recommendation that carries a manifest patch, and a target repo the
     * token can push to. Every attempt is audited.
     */
    sub.post('/investigations/:id/apply', {
      preHandler: rateLimit({ name: 'apply', capacity: 3, refillPerMinute: 0.1 }),
    }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const inv = await q(
        `select i.*, a.owner, a.repo, a.branch, f.package
         from investigations i
         join findings f on f.id = i.finding_id
         join analyses a on a.id = f.analysis_id
         where i.id = $1 and i.user_id = $2`,
        [id, req.user!.id],
      );
      if (!inv.rows[0]) return reply.code(404).send({ error: 'not_found' });
      const row = inv.rows[0];
      const rec = row.recommendation as any;

      if (rec?.action !== 'upgrade-major' || !rec?.patch) {
        return reply.code(409).send({
          error: 'not_applicable',
          message: 'this recommendation does not carry an appliable manifest patch (in-range refreshes need only a lockfile update; monitor actions need none)',
        });
      }

      const tok = await q('select ciphertext, nonce from gh_tokens where user_id = $1', [req.user!.id]);
      if (!tok.rows[0] || !env.TOKEN_ENC_KEY) {
        await audit(req.user!.id, 'remediation.apply_denied', id, { reason: 'no token' }, req.ip);
        return reply.code(428).send({
          error: 'token_required',
          message: 'store a GitHub PAT with repo scope in Settings first; Strata applies remediations only with explicit user-scoped credentials',
        });
      }
      const token = decryptSecret(tok.rows[0].ciphertext, tok.rows[0].nonce);
      const headers = {
        ...githubAuthHeader(token),
        'Content-Type': 'application/json',
      };

      try {
        // 1 — read current package.json at branch head
        const getFile = await fetch(
          `https://api.github.com/repos/${row.owner}/${row.repo}/contents/package.json?ref=${encodeURIComponent(row.branch)}`,
          { headers: { ...githubAuthHeader(token) } },
        );
        if (!getFile.ok) throw new Error(`read package.json: HTTP ${getFile.status}`);
        const file = await getFile.json() as any;

        // 2 — rewrite the dependency constraint
        const pkg = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        const newRange = (rec.patch.to as string).match(/:\s*(.+)$/)?.[1] ?? rec.target;
        if (pkg.dependencies?.[row.package] !== undefined) pkg.dependencies[row.package] = newRange;
        else if (pkg.devDependencies?.[row.package] !== undefined) pkg.devDependencies[row.package] = newRange;
        else throw new Error(`package ${row.package} not found in manifest sections`);
        const newContent = Buffer.from(JSON.stringify(pkg, null, 2) + '\n').toString('base64');

        // 3 — branch from the current head sha
        const branchName = `strata/remediate-${row.package.replace(/[^A-Za-z0-9-]/g, '')}-${Date.now().toString(36)}`;
        const headRes = await fetch(
          `https://api.github.com/repos/${row.owner}/${row.repo}/git/ref/heads/${encodeURIComponent(row.branch)}`,
          { headers: { ...githubAuthHeader(token) } },
        );
        if (!headRes.ok) throw new Error(`resolve branch head: HTTP ${headRes.status}`);
        const headSha = (await headRes.json() as any).object?.sha;
        const refRes2 = await fetch(
          `https://api.github.com/repos/${row.owner}/${row.repo}/git/refs`,
          { method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: headSha }) },
        );
        if (!refRes2.ok && refRes2.status !== 422) throw new Error(`create branch: HTTP ${refRes2.status}`);

        // 4 — commit
        const putRes = await fetch(
          `https://api.github.com/repos/${row.owner}/${row.repo}/contents/package.json`,
          {
            method: 'PUT', headers,
            body: JSON.stringify({
              message: `strata: bump ${row.package} to ${rec.target} (remediates finding)`,
              content: newContent,
              branch: branchName,
              sha: file.sha,
            }),
          },
        );
        if (!putRes.ok) {
          const errText = await putRes.text();
          throw new Error(`commit manifest: HTTP ${putRes.status} ${errText.slice(0, 160)}`);
        }

        // 5 — pull request
        const prRes = await fetch(
          `https://api.github.com/repos/${row.owner}/${row.repo}/pulls`,
          {
            method: 'POST', headers,
            body: JSON.stringify({
              title: `Strata remediation: ${row.package} → ${rec.target}`,
              head: branchName,
              base: row.branch,
              body: `Automated remediation proposed by Verve Strata.\n\n- Finding: ${(row.recommendation as any).rationale}\n- Target: ${rec.target}\n- Confidence: ${row.confidence}\n\nReview the major-version changelog before merging.`,
            }),
          },
        );
        if (!prRes.ok) {
          const errText = await prRes.text();
          throw new Error(`open PR: HTTP ${prRes.status} ${errText.slice(0, 160)}`);
        }
        const pr = await prRes.json() as any;

        await audit(req.user!.id, 'remediation.applied', id, {
          repo: `${row.owner}/${row.repo}`, pr: pr.number, target: rec.target,
        }, req.ip);
        return reply.code(201).send({
          applied: true,
          pr: { number: pr.number, url: pr.html_url, branch: branchName },
        });
      } catch (err: any) {
        await audit(req.user!.id, 'remediation.apply_failed', id, { error: String(err?.message).slice(0, 200) }, req.ip);
        return reply.code(502).send({
          error: 'github_rejected',
          message: `GitHub rejected the remediation: ${err?.message}. Ensure the stored PAT has write access to ${row.owner}/${row.repo}.`,
        });
      }
    });
  }, { prefix: '' });
}
