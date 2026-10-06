import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

export interface DatabaseOptions {
  connectionString: Env['DATABASE_URL'];
  maxConnections: Env['DB_POOL_MAX'];
  logger: Logger;
  /** Application name shown in pg_stat_activity. */
  applicationName?: string;
}

const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;

/**
 * Creates the single pg pool + Kysely instance for the process.
 * Close it with `db.destroy()` on shutdown (this also ends the pool).
 */
export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    application_name: options.applicationName ?? 'urban-ibile-api',
  });

  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => {
    options.logger.error({ err }, 'postgres pool: idle client error');
  });

  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
