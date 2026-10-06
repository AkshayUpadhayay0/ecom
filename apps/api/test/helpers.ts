import { pino } from 'pino';
import type { Response } from 'supertest';
import { createApp } from '../src/app.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/db/database.js';
import { buildAdminAuthService } from '../src/modules/admin-users/admin-auth.module.js';
import type { AdminRole, AdminRow } from '../src/modules/admin-users/admin-users.repository.js';
import { createEmailOutboxRepository } from '../src/modules/notifications/email-outbox.repository.js';
import { createEmailOutboxService } from '../src/modules/notifications/email-outbox.service.js';
import type { OutgoingEmail } from '../src/modules/notifications/email-sender.js';

export { assertSafeTestDatabase } from './safe-database.js';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = testDatabaseUrl !== undefined && testDatabaseUrl !== '';

/** Test-only secrets (never used outside tests). */
export const TEST_SECRETS = {
  JWT_ACCESS_SECRET: 'test-customer-secret-0123456789-abcdefghijklmnop',
  JWT_ADMIN_ACCESS_SECRET: 'test-admin-secret-0123456789-abcdefghijklmnopqrs',
} as const;

export function makeTestEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl ?? '',
    CORS_ORIGINS: 'http://localhost:5173',
    ...TEST_SECRETS,
    // Most tests make many auth calls from one IP; the rate-limit test lowers this.
    AUTH_RATE_LIMIT_MAX: '10000',
    ...overrides,
  });
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: Database;
  env: Env;
}

export function makeTestApp(env: Env): TestContext {
  const logger = pino({ level: env.LOG_LEVEL });
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DB_POOL_MAX,
    logger,
  });
  return { app: createApp({ env, logger, db }), db, env };
}

/** Typed access to a supertest JSON body. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- intentional typed cast for tests
export function bodyOf<T>(res: Response): T {
  return res.body as T;
}

/**
 * Deletes rows written by auth tests. Plain DELETEs in dependency order (not TRUNCATE CASCADE,
 * which would also wipe seeded tables that reference admin_users).
 */
export async function resetAuthTables(db: Database): Promise<void> {
  await db.deleteFrom('auth_sessions').execute();
  await db.deleteFrom('email_verification_tokens').execute();
  await db.deleteFrom('password_reset_tokens').execute();
  await db.deleteFrom('email_outbox').execute();
  await db.deleteFrom('admin_audit_logs').execute();
  await db.deleteFrom('customers').execute();
  await db.deleteFrom('admin_users').execute();
}

export async function createTestAdmin(
  ctx: TestContext,
  input: { email: string; password: string; role?: AdminRole; displayName?: string },
): Promise<AdminRow> {
  const service = buildAdminAuthService(ctx.env, ctx.db, pino({ level: 'silent' }));
  return service.createAdmin({
    email: input.email,
    password: input.password,
    role: input.role ?? 'admin',
    displayName: input.displayName ?? 'Test Admin',
  });
}

/** Runs the outbox once with a capturing sender; returns the emails "sent". */
export async function flushOutbox(ctx: TestContext): Promise<OutgoingEmail[]> {
  const sent: OutgoingEmail[] = [];
  await createEmailOutboxService({
    db: ctx.db,
    repository: createEmailOutboxRepository(),
    sender: {
      send(email) {
        sent.push(email);
        return Promise.resolve();
      },
    },
    from: ctx.env.EMAIL_FROM,
    logger: pino({ level: 'silent' }),
  }).processBatch();
  return sent;
}

/** Extracts `?token=` from the single link in an email body. */
export function tokenFromEmail(email: OutgoingEmail | undefined): string {
  const match = email?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('No token link found in email.');
  return match[1];
}
