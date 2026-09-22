import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../../db.js';
import { hashPassword, verifyPassword } from '../../crypto.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession } from '../session.js';
import { rateLimit, audit } from '../ratelimit.js';

const RegisterBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
});

const LoginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', { preHandler: rateLimit({ name: 'auth', capacity: 10, refillPerMinute: 0.5 }) }, async (req, reply) => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', message: 'valid email and a password of at least 10 characters are required' });
    }
    const email = parsed.data.email.toLowerCase();
    const exists = await q('select 1 from users where email = $1', [email]);
    if (exists.rowCount) {
      return reply.code(409).send({ error: 'email_taken', message: 'an account with this email already exists' });
    }
    const inserted = await q<{ id: string }>(
      'insert into users (email, password_hash) values ($1,$2) returning id',
      [email, hashPassword(parsed.data.password)],
    );
    const userId = inserted.rows[0].id;
    const token = await createSession(userId, req.headers['user-agent']);
    setSessionCookie(reply, token);
    await audit(userId, 'auth.register', email, {}, req.ip);
    return reply.code(201).send({ user: { id: userId, email } });
  });

  app.post('/auth/login', { preHandler: rateLimit({ name: 'auth', capacity: 10, refillPerMinute: 0.5 }) }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', message: 'email and password are required' });
    }
    const rows = await q<{ id: string; password_hash: string }>(
      'select id, password_hash from users where email = $1',
      [parsed.data.email.toLowerCase()],
    );
    const user = rows.rows[0];
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      await audit(null, 'auth.login_failed', parsed.data.email, {}, req.ip);
      return reply.code(401).send({ error: 'invalid_credentials', message: 'invalid email or password' });
    }
    const token = await createSession(user.id, req.headers['user-agent']);
    setSessionCookie(reply, token);
    await audit(user.id, 'auth.login', parsed.data.email, {}, req.ip);
    return reply.send({ user: { id: user.id, email: parsed.data.email } });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies['strata_sid'];
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    await audit(req.user?.id, 'auth.logout', null, {}, req.ip);
    return reply.send({ ok: true });
  });

  app.get('/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    const tok = await q('select created_at from gh_tokens where user_id = $1', [req.user.id]);
    return reply.send({
      user: req.user,
      githubTokenConfigured: !!tok.rows[0],
    });
  });
}
