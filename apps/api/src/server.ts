import { createApp } from './app.js';
import { EnvValidationError, loadEnv, type Env } from './config/env.js';
import { createDatabase } from './db/database.js';
import { createLogger } from './lib/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // The logger depends on config, so report config errors directly.
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const env = readEnvOrExit();
const logger = createLogger(env);
const db = createDatabase({
  connectionString: env.DATABASE_URL,
  maxConnections: env.DB_POOL_MAX,
  logger,
});
const app = createApp({ env, logger, db });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api listening');
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(() => {
    db.destroy()
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'error closing database pool');
        process.exit(1);
      });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  shutdown('SIGTERM');
});
