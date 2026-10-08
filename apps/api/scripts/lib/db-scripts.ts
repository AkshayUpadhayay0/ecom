import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import type pg from 'pg';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const DB_DIR = `${REPO_ROOT}db/`;
const MIGRATIONS_DIR = `${DB_DIR}migrations/`;
const SEEDS_DIR = `${DB_DIR}seeds/`;
const SEED_FILE = /^seed_\d{4}_[a-z0-9_]+\.sql$/;
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Reads one connection URL from the environment / repo-root `.env` (no other config needed). */
export function loadDatabaseUrl(variable: 'DATABASE_URL' | 'TEST_DATABASE_URL'): string {
  loadDotenv({ path: `${REPO_ROOT}.env`, quiet: true });
  const url = process.env[variable];
  if (!url) throw new Error(`${variable} is not set (see .env.example).`);
  return url;
}

async function listMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((file) => MIGRATION_FILE.test(file)).sort();
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Applies every `db/migrations/NNNN_*.sql` not yet recorded in `schema_migrations`, each in its
 * own transaction together with its bookkeeping row. Fails if an applied file was edited.
 */
export async function applyPendingMigrations(
  client: pg.Client,
  log: (line: string) => void,
): Promise<number> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const applied = await client.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations',
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.filename, row.checksum]));

  let count = 0;
  for (const file of await listMigrations()) {
    const sql = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
    const sum = checksum(sql);
    const previous = appliedByName.get(file);
    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(`Migration ${file} was edited after it was applied. Add a new migration.`);
      }
      continue;
    }
    log(`Applying migration ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        file,
        sum,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    count += 1;
  }
  return count;
}

/**
 * Runs every `db/seeds/seed_NNNN_*.sql` in order. Seed files manage their own transaction and must
 * be safe to re-run (they only insert what is missing), so nothing is recorded.
 */
export async function applySeeds(client: pg.Client, log: (line: string) => void): Promise<number> {
  const files = (await readdir(SEEDS_DIR)).filter((file) => SEED_FILE.test(file)).sort();
  for (const file of files) {
    log(`Applying seed ${file}`);
    await client.query(await readFile(`${SEEDS_DIR}${file}`, 'utf8'));
  }
  return files.length;
}
