/**
 * In-memory token-bucket rate limiter, keyed by IP + bucket name.
 * Deliberately simple: one service replica, bounded abuse, honest 429s.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

interface Bucket { tokens: number; last: number }

const buckets = new Map<string, Bucket>();

export interface LimitOpts {
  name: string;
  capacity: number;
  refillPerMinute: number;
}

export function rateLimit(opts: LimitOpts) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = req.ip ?? 'unknown';
    const key = `${opts.name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: opts.capacity, last: now };
      buckets.set(key, b);
    }
    const elapsedMin = (now - b.last) / 60_000;
    b.tokens = Math.min(opts.capacity, b.tokens + elapsedMin * opts.refillPerMinute);
    b.last = now;

    if (b.tokens < 1) {
      const retry = Math.ceil((1 - b.tokens) / opts.refillPerMinute * 60);
      reply.header('Retry-After', String(Math.max(1, retry)));
      return reply.code(429).send({
        error: 'rate_limited',
        message: `rate limit exceeded for ${opts.name}, retry in ~${retry}s`,
      });
    }
    b.tokens -= 1;

    // opportunistic GC
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) {
        if (now - v.last > 3_600_000) buckets.delete(k);
      }
    }
    return; // pass
  };
}

export async function audit(
  userId: string | null | undefined,
  action: string,
  target: string | null,
  meta: Record<string, unknown>,
  ip: string | undefined,
): Promise<void> {
  try {
    const { q } = await import('../db.js');
    await q(
      'insert into audit_log (user_id, action, target, meta, ip) values ($1,$2,$3,$4,$5)',
      [userId ?? null, action, target, JSON.stringify(meta), ip ?? null],
    );
  } catch { /* audit must never break the request path */ }
}
