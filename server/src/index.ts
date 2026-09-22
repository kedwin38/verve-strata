import { env } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db.js';
import { buildApp } from './http/app.js';

async function main(): Promise<void> {
  await migrate();
  const app = await buildApp();

  app.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logger.error({ err }, 'listen failed');
      process.exit(1);
    }
    logger.info({ address, env: env.NODE_ENV }, 'Verve Strata listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});
