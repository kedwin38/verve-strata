import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 bytes'),
  // Optional server-level GitHub token used to raise API rate limits for
  // unauthenticated workspaces. Never required; never written to disk.
  GITHUB_TOKEN: z.string().optional(),
  // 32-byte hex key for encrypting user-scoped GitHub PATs at rest.
  TOKEN_ENC_KEY: z.string().length(64).optional(),
  LOG_LEVEL: z.string().default('info'),
  // Engine tuning
  STRATA_MAX_DEPTH: z.coerce.number().int().positive().default(60),
  STRATA_IMPORT_SAMPLE: z.coerce.number().int().positive().default(100),
});

export const env = Env.parse(process.env);

export const isProd = env.NODE_ENV === 'production';
