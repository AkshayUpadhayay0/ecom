/**
 * Applies pending db/migrations/*.sql to the main database (DATABASE_URL).
 *
 *   pnpm db:migrate          then   pnpm db:codegen
 */
import pg from 'pg';
import { applyPendingMigrations, loadDatabaseUrl } from './lib/db-scripts.js';

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: loadDatabaseUrl('DATABASE_URL') });
  await client.connect();
  try {
    const count = await applyPendingMigrations(client, (line) => {
      console.log(line);
    });
    console.log(count === 0 ? 'No pending migrations.' : `Applied ${count} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
