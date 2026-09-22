import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../../db.js';
import { env } from '../../config.js';
import { runAnalysis } from '../../engine/runner.js';
import { rateLimit, audit } from '../ratelimit.js';

const RepoRef = z.string().regex(
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/,
  'expected owner/repo',
);

const CreateBody = z.object({
  repo: RepoRef,
  depth: z.number().int().min(10).max(100).optional(),
});

function requireUser(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'unauthenticated', message: 'sign in to run analyses' });
    }
  });
}

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (sub) => {
    requireUser(sub);

    sub.post('/analyses', {
      preHandler: rateLimit({ name: 'analysis', capacity: 6, refillPerMinute: 0.1 }),
    }, async (req, reply) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: parsed.error.issues[0].message });
      }
      const [owner, repo] = parsed.data.repo.split('/');
      const inserted = await q<{ id: string }>(
        `insert into analyses (user_id, owner, repo) values ($1,$2,$3) returning id`,
        [req.user!.id, owner, repo],
      );
      const id = inserted.rows[0].id;
      await audit(req.user!.id, 'analysis.create', `${owner}/${repo}`, { id }, req.ip);
      // fire-and-forget; the runner claims the row and updates status
      void runAnalysis(id, req.user!.id);
      return reply.code(202).send({ id, status: 'queued' });
    });

    sub.get('/analyses', async (req) => {
      const rows = await q(
        `select id, owner, repo, branch, ecosystem, status, error, truncated, stats,
                created_at, completed_at
         from analyses where user_id = $1 order by created_at desc limit 50`,
        [req.user!.id],
      );
      return { analyses: rows.rows };
    });

    sub.get('/analyses/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await q(
        `select id, owner, repo, branch, ecosystem, status, error, truncated, degraded,
                progress, stats, created_at, completed_at
         from analyses where id = $1 and user_id = $2`,
        [id, req.user!.id],
      );
      if (!rows.rows[0]) return reply.code(404).send({ error: 'not_found' });
      return rows.rows[0];
    });

    sub.get('/analyses/:id/strata', async (req, reply) => {
      const { id } = req.params as { id: string };
      const own = await q('select 1 from analyses where id = $1 and user_id = $2', [id, req.user!.id]);
      if (!own.rowCount) return reply.code(404).send({ error: 'not_found' });
      const rows = await q(
        `select * from strata_records where analysis_id = $1
         order by risk desc, exposure_days desc, name asc`,
        [id],
      );
      return { strata: rows.rows };
    });

    sub.get('/analyses/:id/events', async (req, reply) => {
      const { id } = req.params as { id: string };
      const own = await q('select 1 from analyses where id = $1 and user_id = $2', [id, req.user!.id]);
      if (!own.rowCount) return reply.code(404).send({ error: 'not_found' });
      const rows = await q(
        `select * from deposition_events where analysis_id = $1
         order by committed_at desc limit 1000`,
        [id],
      );
      return { events: rows.rows };
    });

    sub.get('/analyses/:id/findings', async (req, reply) => {
      const { id } = req.params as { id: string };
      const own = await q('select 1 from analyses where id = $1 and user_id = $2', [id, req.user!.id]);
      if (!own.rowCount) return reply.code(404).send({ error: 'not_found' });
      const rows = await q(
        `select f.*, i.id as investigation_id
         from findings f
         left join investigations i on i.finding_id = f.id
         where f.analysis_id = $1
         order by
           case f.severity
             when 'critical' then 5 when 'high' then 4 when 'moderate' then 3
             when 'low' then 2 else 1 end desc,
           f.exposure_days desc`,
        [id],
      );
      return { findings: rows.rows };
    });
  }, { prefix: '' });
}
