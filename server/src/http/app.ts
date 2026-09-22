import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from '../db.js';
import { registerSession } from './session.js';
import { authRoutes } from './routes/auth.js';
import { analysisRoutes } from './routes/analyses.js';
import { investigationRoutes } from './routes/investigations.js';
import { sentinelRoutes } from './routes/sentinel.js';
import { settingsRoutes } from './routes/settings.js';
import { rateLimit } from './ratelimit.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // pino instance wired in index.ts via streams if needed
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  // security headers
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  await registerSession(app);

  // global API rate limit (per-IP), tighter limits inside routes
  app.register(async (api) => {
    api.addHook('preHandler', rateLimit({ name: 'global', capacity: 240, refillPerMinute: 120 }));
    await api.register(authRoutes);
    await api.register(analysisRoutes);
    await api.register(investigationRoutes);
    await api.register(sentinelRoutes);
    await api.register(settingsRoutes);

    api.get('/meta', async () => ({
      product: 'Verve Strata',
      category: 'Dependency Provenance Intelligence',
      vendor: 'Verve Enterprises',
      version: '1.0.0',
      loop: ['excavate', 'correlate', 'weigh', 'gate', 'remediate'],
    }));
  }, { prefix: '/api/v1' });

  app.get('/healthz', async (_req, reply) => {
    try {
      await q('select 1');
      return { status: 'ok', db: 'up', ts: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });

  // static SPA + fallback
  const webDist = join(here, '..', '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler(async (req, reply) => {
      return reply.code(404).send({
        error: 'not_found',
        message: 'web bundle not built; API is live at /api/v1',
      });
    });
  }

  app.setErrorHandler((err: unknown, req, reply) => {
    const ferr = err as { statusCode?: number; message?: string };
    const status = ferr.statusCode && ferr.statusCode >= 400 ? ferr.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_failed',
      message: status >= 500 ? 'unexpected server error' : ferr.message ?? 'request failed',
    });
  });

  return app;
}
