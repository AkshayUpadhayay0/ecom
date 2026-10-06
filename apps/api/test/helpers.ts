import { pino } from 'pino';
import { createApp } from '../src/app.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/db/database.js';

export { assertSafeTestDatabase } from './safe-database.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = testDatabaseUrl !== undefined && testDatabaseUrl !== '';

export function makeTestEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl ?? '',
    CORS_ORIGINS: 'http://localhost:5173',
    ...overrides,
  });
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: Database;
}

export function makeTestApp(env: Env): TestContext {
  const logger = pino({ level: env.LOG_LEVEL });
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DB_POOL_MAX,
    logger,
  });
  return { app: createApp({ env, logger, db }), db };
}
