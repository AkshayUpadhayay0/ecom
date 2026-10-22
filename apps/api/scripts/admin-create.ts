/**
 * Creates an admin account interactively. The password is typed with hidden input and is never
 * accepted as a command-line argument (it would end up in shell history).
 *
 *   pnpm admin:create
 */
import { emailSchema } from '@urban-ibile/shared';
import { pino } from 'pino';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { AppError } from '../src/lib/errors.js';
import { buildAdminAuthService } from '../src/modules/admin-users/admin-auth.module.js';
import type { AdminRole } from '../src/modules/admin-users/admin-users.repository.js';
import { ask, askHidden } from './lib/prompt.js';

const ROLES: readonly AdminRole[] = ['admin', 'super_admin'];
const MAX_DISPLAY_NAME = 120;

async function main(): Promise<void> {
  const env = loadEnv();
  console.log('Create an Urban Ibile admin account.\n');

  const emailInput = await ask('Email: ');
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) throw new Error('That is not a valid email address.');

  const displayName = await ask('Display name: ');
  if (displayName.length === 0 || displayName.length > MAX_DISPLAY_NAME) {
    throw new Error(`Display name must be 1-${MAX_DISPLAY_NAME} characters.`);
  }

  const roleInput = (await ask('Role [admin / super_admin] (default admin): ')) || 'admin';
  const role = ROLES.find((candidate) => candidate === roleInput);
  if (role === undefined) throw new Error('Role must be "admin" or "super_admin".');

  const password = await askHidden(`Password (min ${env.PASSWORD_MIN_LENGTH} characters): `);
  const confirm = await askHidden('Repeat password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');

  const logger = pino({ level: 'warn' });
  const db = createDatabase({ connectionString: env.DATABASE_URL, maxConnections: 1, logger });
  try {
    const admin = await buildAdminAuthService(env, db, logger).createAdmin({
      email: email.data,
      displayName,
      password,
      role,
    });
    console.log(`\nAdmin created: ${admin.email} (${admin.role}), id ${admin.id}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    const reasons = (err.details as { reasons?: string[] } | undefined)?.reasons ?? [];
    console.error([`\n${err.message}`, ...reasons.map((r) => `  - ${r}`)].join('\n'));
  } else if (err instanceof EnvValidationError || err instanceof Error) {
    console.error(`\n${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
