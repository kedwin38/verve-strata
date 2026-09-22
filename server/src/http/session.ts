/**
 * Sessions: opaque 32-byte tokens in a SameSite=Strict cookie; only the
 * SHA-256 hash is stored server-side. CSRF strategy: mutations must carry the
 * `x-strata-client` header (which cross-site form posts cannot set) plus the
 * strict cookie policy.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { q } from '../db.js';
import { newSessionToken, sha256 } from '../crypto.js';

const COOKIE = 'strata_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

export async function createSession(
  userId: string, userAgent: string | undefined,
): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  await q(
    `insert into sessions (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + interval '7 days', $3)`,
    [tokenHash, userId, (userAgent ?? '').slice(0, 300)],
  );
  return token;
}

export function destroySession(token: string): Promise<unknown> {
  return q('delete from sessions where token_hash = $1', [sha256(token)]);
}

export async function registerSession(app: FastifyInstance): Promise<void> {
  await app.register(cookie, {
    secret: process.env.SESSION_SECRET!,
    parseOptions: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    },
  });

  app.addHook('preHandler', async (req) => {
    const token = req.cookies[COOKIE];
    if (!token) return;
    const rows = await q(
      `select u.id, u.email from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    );
    if (rows.rows[0]) req.user = rows.rows[0] as { id: string; email: string };
  });

  // CSRF gate for mutating methods
  app.addHook('onRequest', async (req, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const api = req.url.startsWith('/api/');
      const originHeader = req.headers['x-strata-client'];
      if (api && originHeader !== '1') {
        return reply.code(403).send({
          error: 'csrf_rejected',
          message: 'mutating API calls require the x-strata-client header',
        });
      }
    }
  });
}

export function setSessionCookie(reply: any, token: string) {
  reply.setCookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: any) {
  reply.clearCookie(COOKIE, { path: '/' });
}
