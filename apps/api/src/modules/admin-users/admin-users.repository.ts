import type { Database } from '../../db/database.js';

export type AdminRole = 'super_admin' | 'admin';

export interface AdminRow {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
}

export interface NewAdmin {
  email: string;
  passwordHash: string;
  displayName: string;
  role: AdminRole;
}

const ADMIN_COLUMNS = [
  'id',
  'email',
  'password_hash as passwordHash',
  'display_name as displayName',
  'role',
  'is_active as isActive',
  'must_change_password as mustChangePassword',
  'locked_until as lockedUntil',
] as const;

const UNIQUE_VIOLATION = '23505';

/** `role` is CHECK-constrained to the AdminRole values. */
function toAdminRow<T extends { role: string }>(row: T): T & { role: AdminRole } {
  return { ...row, role: row.role as AdminRole };
}

export interface AdminUsersRepository {
  findByEmail(db: Database, email: string): Promise<AdminRow | undefined>;
  findById(db: Database, id: string): Promise<AdminRow | undefined>;
  /** Returns undefined if the email is already used. */
  insert(db: Database, admin: NewAdmin): Promise<AdminRow | undefined>;
  updatePassword(db: Database, id: string, passwordHash: string): Promise<void>;
  isActive(db: Database, id: string): Promise<boolean>;
}

export function createAdminUsersRepository(): AdminUsersRepository {
  return {
    async findByEmail(db, email) {
      const row = await db
        .selectFrom('admin_users')
        .select(ADMIN_COLUMNS)
        .where('email', '=', email)
        .executeTakeFirst();
      return row && toAdminRow(row);
    },

    async findById(db, id) {
      const row = await db
        .selectFrom('admin_users')
        .select(ADMIN_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      return row && toAdminRow(row);
    },

    async insert(db, admin) {
      try {
        const row = await db
          .insertInto('admin_users')
          .values({
            email: admin.email,
            password_hash: admin.passwordHash,
            display_name: admin.displayName,
            role: admin.role,
          })
          .returning(ADMIN_COLUMNS)
          .executeTakeFirstOrThrow();
        return toAdminRow(row);
      } catch (err) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === UNIQUE_VIOLATION
        ) {
          return undefined;
        }
        throw err;
      }
    },

    async updatePassword(db, id, passwordHash) {
      await db
        .updateTable('admin_users')
        .set({
          password_hash: passwordHash,
          must_change_password: false,
          failed_login_count: 0,
          locked_until: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async isActive(db, id) {
      const row = await db
        .selectFrom('admin_users')
        .select('id')
        .where('id', '=', id)
        .where('is_active', '=', true)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
