/**
 * Lists admin accounts with their role (read-only; never prints password hashes or tokens).
 * Use it to check which account a tester signs in with: role `admin` is the client's staff,
 * `super_admin` is a developer (sees the Internal section).
 *
 *   pnpm admin:list
 */
import { pino } from 'pino';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = pino({ level: 'silent' });
  const db = createDatabase({ connectionString: env.DATABASE_URL, maxConnections: 1, logger });
  try {
    const rows = await db
      .selectFrom('admin_users')
      .select(['email', 'display_name', 'role', 'is_active', 'last_login_at'])
      .orderBy('created_at')
      .execute();
    if (rows.length === 0) {
      console.log('No admin accounts yet. Create one with: pnpm admin:create');
      return;
    }
    console.table(
      rows.map((row) => ({
        email: row.email,
        name: row.display_name,
        role: row.role,
        active: row.is_active,
        lastLogin: row.last_login_at?.toISOString() ?? 'never',
      })),
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof EnvValidationError || err instanceof Error ? err.message : err);
  process.exit(1);
});
