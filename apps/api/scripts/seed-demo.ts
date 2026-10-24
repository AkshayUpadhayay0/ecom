/**
 * Demo data for local development and client demos. Everything it creates is marked SAMPLE and is
 * removed again by the remove command. Refused in production.
 *
 *   pnpm seed:demo            create / refresh the demo data
 *   pnpm seed:demo:remove     remove it (a zone that addresses or orders already use is deactivated
 *                             instead, because their history must stay intact)
 *
 * Today the demo data is one delivery zone, so addresses can be saved and the cart can be tried
 * before the client supplies the real zones (PENDING CLIENT DECISION: areas, fees, timings).
 */
import pg from 'pg';
import { loadDatabaseUrl } from './lib/db-scripts.js';

const FOREIGN_KEY_VIOLATION = '23503';

/** SAMPLE / TEMPORARY: not a real delivery area or fee. */
export const DEMO_ZONE = {
  code: 'demo-sample-zone',
  name: 'Sample zone (temporary)',
  /** Clearly a placeholder amount (NGN 1,500.00 in minor units). */
  feeMinor: 150_000,
  estDaysMin: 2,
  estDaysMax: 4,
  sortOrder: 900,
} as const;

async function create(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO delivery_zones (code, name, fee_minor, est_days_min, est_days_max, is_active, is_sample_data, sort_order)
     VALUES ($1, $2, $3, $4, $5, true, true, $6)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, fee_minor = EXCLUDED.fee_minor, est_days_min = EXCLUDED.est_days_min,
           est_days_max = EXCLUDED.est_days_max, is_active = true, is_sample_data = true`,
    [
      DEMO_ZONE.code,
      DEMO_ZONE.name,
      DEMO_ZONE.feeMinor,
      DEMO_ZONE.estDaysMin,
      DEMO_ZONE.estDaysMax,
      DEMO_ZONE.sortOrder,
    ],
  );
  console.log(
    `Demo zone ready: "${DEMO_ZONE.name}" (SAMPLE fee ${DEMO_ZONE.feeMinor / 100} NGN, not a real price).`,
  );
}

async function remove(client: pg.Client): Promise<void> {
  try {
    const result = await client.query('DELETE FROM delivery_zones WHERE code = $1', [
      DEMO_ZONE.code,
    ]);
    console.log(result.rowCount ? 'Demo zone removed.' : 'No demo zone to remove.');
  } catch (err) {
    if ((err as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw err;
    await client.query('UPDATE delivery_zones SET is_active = false WHERE code = $1', [
      DEMO_ZONE.code,
    ]);
    console.log('Demo zone is used by saved addresses or orders: deactivated instead of deleted.');
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:demo creates sample data and is refused in production.');
  }
  const client = new pg.Client({ connectionString: loadDatabaseUrl('DATABASE_URL') });
  await client.connect();
  try {
    if (process.argv.includes('--remove')) await remove(client);
    else await create(client);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
