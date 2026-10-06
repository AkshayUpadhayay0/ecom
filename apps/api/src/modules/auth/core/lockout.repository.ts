import { sql } from 'kysely';
import type { Database } from '../../../db/database.js';

/** Tables with `failed_login_count` / `locked_until` / `last_login_at` columns. */
export type AccountTable = 'customers' | 'admin_users';

export interface LockoutPolicy {
  maxFailedLogins: number;
  lockoutMinutes: number;
}

/**
 * Atomically counts a failed attempt. On reaching the limit the account is locked and the
 * counter resets, so the next window starts fresh. Returns the resulting `locked_until`.
 */
export async function recordFailedLogin(
  db: Database,
  table: AccountTable,
  id: string,
  policy: LockoutPolicy,
): Promise<Date | null> {
  const { rows } = await sql<{ locked_until: Date | null }>`
    UPDATE ${sql.table(table)} SET
      failed_login_count = CASE WHEN failed_login_count + 1 >= ${policy.maxFailedLogins}
                                THEN 0 ELSE failed_login_count + 1 END,
      locked_until       = CASE WHEN failed_login_count + 1 >= ${policy.maxFailedLogins}
                                THEN now() + make_interval(mins => ${policy.lockoutMinutes})
                                ELSE locked_until END
    WHERE id = ${id}
    RETURNING locked_until`.execute(db);
  return rows[0]?.locked_until ?? null;
}

export async function recordSuccessfulLogin(
  db: Database,
  table: AccountTable,
  id: string,
): Promise<void> {
  await sql`
    UPDATE ${sql.table(table)}
    SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
    WHERE id = ${id}`.execute(db);
}
