import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  assertSafeTestDatabase,
  describeDatabaseError,
  redactUrl,
  resolveTestDatabaseUrl,
} from './safe-database.js';

const CONNECT_TIMEOUT_MS = 5000;
const SCHEMA_MARKER = 'schema_migrations';

/**
 * Runs once before the API test suite: checks that the test database is reachable with the
 * configured credentials and set up, and stops with a clear, password-free message otherwise.
 */
export default async function checkTestDatabase(): Promise<void> {
  loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  const resolved = resolveTestDatabaseUrl(process.env);
  if (!resolved) {
    process.stderr.write(
      'No DATABASE_URL / TEST_DATABASE_URL set: database integration tests are skipped (see README, "Running the tests").\n',
    );
    return;
  }
  assertSafeTestDatabase(resolved.url);
  const client = new pg.Client({
    connectionString: resolved.url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    const marker = await client.query<{ table: string | null }>('SELECT to_regclass($1) AS table', [
      SCHEMA_MARKER,
    ]);
    if (marker.rows[0]?.table == null) {
      throw new Error(
        `The test database ${redactUrl(resolved.url)} exists but has no schema yet.\nFix: run  pnpm db:test:setup  (applies the schema and all migrations).`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('pnpm db:test:setup')) throw error;
    // pg error messages never contain the password; the URL in our message is redacted.
    throw new Error(describeDatabaseError(error, resolved), { cause: error });
  } finally {
    await client.end().catch(() => undefined);
  }
}
