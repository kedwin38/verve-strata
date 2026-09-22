/**
 * Settings: store/remove a user-scoped GitHub PAT. Stored AES-256-GCM
 * encrypted; never returned by any endpoint. Optional — Strata runs
 * anonymous/server-tokened without it, just slower against rate limits.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../../db.js';
import { env } from '../../config.js';
import { encryptSecret } from '../../crypto.js';
import { rateLimit, audit } from '../ratelimit.js';

const Body = z.object({ token: z.string().regex(/^gh[pousr]_[A-Za-z0-9_]{20,}$/) });

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (sub) => {
    sub.addHook('preHandler', async (req, reply) => {
      if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    });

    sub.put('/settings/github-token', {
      preHandler: rateLimit({ name: 'settings', capacity: 5, refillPerMinute: 0.2 }),
    }, async (req, reply) => {
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: 'expected a GitHub PAT (ghp_/gho_/… prefix)' });
      }
      if (!env.TOKEN_ENC_KEY) {
        return reply.code(503).send({
          error: 'encryption_unavailable',
          message: 'server lacks TOKEN_ENC_KEY — refusing to store tokens rather than store plaintext',
        });
      }
      // validate the token against GitHub before storing
      const check = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${parsed.data.token}`, 'User-Agent': 'verve-strata/1.0' },
      });
      if (!check.ok) {
        return reply.code(400).send({ error: 'token_rejected', message: `GitHub rejected this token (HTTP ${check.status})` });
      }
      const login = (await check.json() as any).login as string;

      const box = encryptSecret(parsed.data.token);
      await q(
        `insert into gh_tokens (user_id, ciphertext, nonce, created_at)
         values ($1,$2,$3, now())
         on conflict (user_id) do update set ciphertext = excluded.ciphertext,
           nonce = excluded.nonce, created_at = now()`,
        [req.user!.id, box.ciphertext, box.nonce],
      );
      await audit(req.user!.id, 'settings.token_stored', login, {}, req.ip);
      return reply.send({ configured: true, login });
    });

    sub.delete('/settings/github-token', async (req, reply) => {
      await q('delete from gh_tokens where user_id = $1', [req.user!.id]);
      await audit(req.user!.id, 'settings.token_removed', null, {}, req.ip);
      return reply.send({ configured: false });
    });
  }, { prefix: '' });
}
