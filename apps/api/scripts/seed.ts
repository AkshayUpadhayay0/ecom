/**
 * Applies db/seeds/*.sql (re-runnable sample data for migrations) to the main database.
 *
 *   pnpm db:migrate   then   pnpm db:seed
 */
import pg from 'pg';
import { applySeeds, loadDatabaseUrl } from './lib/db-scripts.js';

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: loadDatabaseUrl('DATABASE_URL') });
  await client.connect();
  try {
    const count = await applySeeds(client, (line) => {
      console.log(line);
    });
    console.log(`Applied ${count} seed file(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
