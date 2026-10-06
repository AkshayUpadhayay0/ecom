/**
 * Creates the integration-test database (TEST_DATABASE_URL, e.g. `ecom_test`) if it does not
 * exist and applies db/schema_v2.sql, db/migrations/*.sql and db/seed_v2.sql to it once.
 * Refuses to run against the main `ecom` database.
 *
 *   pnpm db:test:setup
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { assertSafeTestDatabase } from '../test/safe-database.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DB_DIR = `${REPO_ROOT}db/`;
const MAINTENANCE_DATABASE = 'postgres';
// Any table from the baseline schema: if present, the baseline was already applied.
const BASELINE_MARKER_TABLE = 'languages';

loadDotenv({ path: `${REPO_ROOT}.env`, quiet: true });

async function databaseExists(adminUrl: string, name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (result.rowCount === 0) {
      // Identifiers cannot be parameterised; the name is quoted and comes from local config.
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
      return false;
    }
    return true;
  } finally {
    await client.end();
  }
}

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(`${DB_DIR}migrations`);
  return entries.filter((file) => file.endsWith('.sql')).sort();
}

async function applyBaseline(testUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    const marker = await client.query('SELECT to_regclass($1) AS table', [BASELINE_MARKER_TABLE]);
    if ((marker.rows[0] as { table: string | null }).table !== null) {
      console.log('Schema already present; nothing to apply.');
      return;
    }
    const files = [
      'schema_v2.sql',
      ...(await migrationFiles()).map((f) => `migrations/${f}`),
      'seed_v2.sql',
    ];
    for (const file of files) {
      console.log(`Applying db/${file}`);
      await client.query(await readFile(`${DB_DIR}${file}`, 'utf8'));
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');
  assertSafeTestDatabase(testUrl);

  const url = new URL(testUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = `/${MAINTENANCE_DATABASE}`;

  const existed = await databaseExists(url.toString(), name);
  console.log(existed ? `Database "${name}" exists.` : `Created database "${name}".`);
  await applyBaseline(testUrl);
  console.log('Test database ready.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
