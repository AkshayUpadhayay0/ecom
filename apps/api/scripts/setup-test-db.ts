/**
 * Prepares the integration-test database (TEST_DATABASE_URL, e.g. `ecom_test`):
 * creates it if missing, applies db/schema_v2.sql + db/seed_v2.sql once, then any pending
 * db/migrations. Safe to re-run. Refuses to run against the main `ecom` database.
 *
 *   pnpm db:test:setup
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertSafeTestDatabase } from '../test/safe-database.js';
import { DB_DIR, applyPendingMigrations, loadDatabaseUrl } from './lib/db-scripts.js';

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
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const testUrl = loadDatabaseUrl('TEST_DATABASE_URL');
  assertSafeTestDatabase(testUrl);

  const url = new URL(testUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${MAINTENANCE_DATABASE}`;

  await ensureDatabase(url.toString(), name);
  await prepareSchema(testUrl);
  console.log('Test database ready.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
