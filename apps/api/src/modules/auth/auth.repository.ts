import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface CustomerRow {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  preferredLanguage: string;
  emailVerifiedAt: Date | null;
  status: string;
  lockedUntil: Date | null;
  createdAt: Date;
}

export interface NewCustomer {
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  termsVersion: string;
}

export interface CustomerProfilePatch {
  fullName?: string;
  phone?: string | null;
  preferredLanguage?: string;
}

const CUSTOMER_COLUMNS = [
  'id',
  'email',
  'password_hash as passwordHash',
  'full_name as fullName',
  'phone',
  'preferred_language as preferredLanguage',
  'email_verified_at as emailVerifiedAt',
  'status',
  'locked_until as lockedUntil',
  'created_at as createdAt',
] as const;

/** One-time token tables: same columns, different owner. */
type OneTimeTokenTable = 'email_verification_tokens' | 'password_reset_tokens';

export interface AuthRepository {
  findCustomerByEmail(db: Database, email: string): Promise<CustomerRow | undefined>;
  findCustomerById(db: Database, id: string): Promise<CustomerRow | undefined>;
  /** Returns undefined if the email is already registered (unique violation). */
  insertCustomer(db: Database, customer: NewCustomer): Promise<CustomerRow | undefined>;
  updateCustomerProfile(
    db: Database,
    id: string,
    patch: CustomerProfilePatch,
  ): Promise<CustomerRow | undefined>;
  isCustomerActive(db: Database, id: string): Promise<boolean>;
  isLanguageActive(db: Database, code: string): Promise<boolean>;
  markEmailVerified(db: Database, customerId: string): Promise<void>;
  updatePassword(db: Database, customerId: string, passwordHash: string): Promise<void>;

  /** Invalidates earlier unused tokens of the same kind, then stores the new one. */
  replaceOneTimeToken(
    db: Database,
    table: OneTimeTokenTable,
    customerId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  /** Customer id for a valid (unused, unexpired) token, without consuming it. */
  findValidOneTimeToken(
    db: Database,
    table: OneTimeTokenTable,
    tokenHash: string,
  ): Promise<string | undefined>;
  /** Atomically marks a valid token used; returns its customer id (undefined = invalid). */
  consumeOneTimeToken(
    db: Database,
    table: OneTimeTokenTable,
    tokenHash: string,
  ): Promise<string | undefined>;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

export function createAuthRepository(): AuthRepository {
  return {
    findCustomerByEmail(db, email) {
      return db
        .selectFrom('customers')
        .select(CUSTOMER_COLUMNS)
        .where('email', '=', email)
        .executeTakeFirst();
    },

    findCustomerById(db, id) {
      return db
        .selectFrom('customers')
        .select(CUSTOMER_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async insertCustomer(db, c) {
      try {
        return await db
          .insertInto('customers')
          .values({
            email: c.email,
            password_hash: c.passwordHash,
            full_name: c.fullName,
            phone: c.phone,
            terms_accepted_at: sql`now()`,
            terms_version: c.termsVersion,
          })
          .returning(CUSTOMER_COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err)) return undefined;
        throw err;
      }
    },

    updateCustomerProfile(db, id, patch) {
      return db
        .updateTable('customers')
        .set({
          ...(patch.fullName !== undefined && { full_name: patch.fullName }),
          ...(patch.phone !== undefined && { phone: patch.phone }),
          ...(patch.preferredLanguage !== undefined && {
            preferred_language: patch.preferredLanguage,
          }),
        })
        .where('id', '=', id)
        .returning(CUSTOMER_COLUMNS)
        .executeTakeFirst();
    },

    async isCustomerActive(db, id) {
      const row = await db
        .selectFrom('customers')
        .select('id')
        .where('id', '=', id)
        .where('status', '=', 'active')
        .executeTakeFirst();
      return row !== undefined;
    },

    async isLanguageActive(db, code) {
      const row = await db
        .selectFrom('languages')
        .select('code')
        .where('code', '=', code)
        .where('is_active', '=', true)
        .executeTakeFirst();
      return row !== undefined;
    },

    async markEmailVerified(db, customerId) {
      await db
        .updateTable('customers')
        .set({ email_verified_at: sql`coalesce(email_verified_at, now())` })
        .where('id', '=', customerId)
        .execute();
    },

    async updatePassword(db, customerId, passwordHash) {
      await db
        .updateTable('customers')
        .set({ password_hash: passwordHash, failed_login_count: 0, locked_until: null })
        .where('id', '=', customerId)
        .execute();
    },

    async replaceOneTimeToken(db, table, customerId, tokenHash, expiresAt) {
      await db
        .updateTable(table)
        .set({ used_at: sql`now()` })
        .where('customer_id', '=', customerId)
        .where('used_at', 'is', null)
        .execute();
      await db
        .insertInto(table)
        .values({ customer_id: customerId, token_hash: tokenHash, expires_at: expiresAt })
        .execute();
    },

    async findValidOneTimeToken(db, table, tokenHash) {
      const row = await db
        .selectFrom(table)
        .select('customer_id')
        .where('token_hash', '=', tokenHash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirst();
      return row?.customer_id;
    },

    async consumeOneTimeToken(db, table, tokenHash) {
      const row = await db
        .updateTable(table)
        .set({ used_at: sql`now()` })
        .where('token_hash', '=', tokenHash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .returning('customer_id')
        .executeTakeFirst();
      return row?.customer_id;
    },
  };
}
