/**
 * Prepares the integration-test database: creates it if missing, applies db/schema_v2.sql +
 * db/seed_v2.sql once, then any pending db/migrations, then db/seeds (re-runnable). Safe to re-run.
 * Uses TEST_DATABASE_URL, or DATABASE_URL with the database name changed to "<name>_test".
 * Refuses any database whose name does not end in "_test". Never prints passwords.
 *
 *   pnpm db:test:setup
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import {
  assertSafeTestDatabase,
  describeDatabaseError,
  redactUrl,
  resolveTestDatabaseUrl,
  type ResolvedTestDatabase,
} from '../test/safe-database.js';
import { DB_DIR, REPO_ROOT, applyPendingMigrations, applySeeds } from './lib/db-scripts.js';

const MAINTENANCE_DATABASE = 'postgres';
// Any table from the baseline schema: if present, the baseline was already applied.
const BASELINE_MARKER_TABLE = 'languages';

async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (result.rowCount === 0) {
      // Identifiers cannot be parameterised; the name is quoted and comes from local config.
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
      console.log(`Created database "${name}".`);
    } else {
      console.log(`Database "${name}" exists.`);
    }
  } finally {
    await client.end();
  }
}

async function prepareSchema(testUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    const marker = await client.query('SELECT to_regclass($1) AS table', [BASELINE_MARKER_TABLE]);
    if ((marker.rows[0] as { table: string | null }).table === null) {
      for (const file of ['schema_v2.sql', 'seed_v2.sql']) {
        console.log(`Applying db/${file}`);
        await client.query(await readFile(`${DB_DIR}${file}`, 'utf8'));
      }
    } else {
      console.log('Baseline schema already present.');
    }
    const count = await applyPendingMigrations(client, (line) => {
      console.log(line);
    });
    console.log(count === 0 ? 'No pending migrations.' : `Applied ${count} migration(s).`);
    await applySeeds(client, (line) => {
      console.log(line);
    });
  } finally {
    await client.end();
  }
}

let resolved: ResolvedTestDatabase | undefined;

async function main(): Promise<void> {
  loadDotenv({ path: `${REPO_ROOT}.env`, quiet: true });
  resolved = resolveTestDatabaseUrl(process.env);
  if (!resolved) throw new Error('DATABASE_URL is not set (see .env.example and the README).');
  const testUrl = resolved.url;
  assertSafeTestDatabase(testUrl);
  console.log(
    `Test database: ${redactUrl(testUrl)}${resolved.derived ? ' (derived from DATABASE_URL)' : ''}`,
  );

  const url = new URL(testUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${MAINTENANCE_DATABASE}`;

  await ensureDatabase(url.toString(), name);
  await prepareSchema(testUrl);
  console.log('Test database ready.');
}

main().catch((err: unknown) => {
  const code = (err as { code?: string } | null)?.code;
  // Connection / authentication problems get the step-by-step explanation (no password shown).
  console.error(
    resolved && code
      ? describeDatabaseError(err, resolved)
      : err instanceof Error
        ? err.message
        : err,
  );
  process.exit(1);
});
