/**
 * Resets an admin's password (any role, e.g. a super_admin whose password leaked). For operators
 * with server / database access; there is no HTTP route for this.
 *
 * The new password is typed twice with hidden input: never a command-line argument (shell
 * history), never echoed or logged. The normal password rules apply. Every session of that admin
 * is revoked (all refresh tokens; access tokens stop working at once), lockout is cleared, and an
 * `admin.password_reset` audit entry is written.
 *
 *   pnpm admin:reset-password --email akshay@dev.com
 */
import { emailSchema } from '@urban-ibile/shared';
import { pino } from 'pino';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { AppError } from '../src/lib/errors.js';
import { buildAdminAuthService } from '../src/modules/admin-users/admin-auth.module.js';
import { askHidden } from './lib/prompt.js';

function usage(): never {
  console.error('Usage: pnpm admin:reset-password --email <admin email>');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf('--email');
  const emailArg = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
  if (!emailArg) usage();
  const email = emailSchema.safeParse(emailArg);
  if (!email.success) throw new Error('That is not a valid email address.');

  const env = loadEnv();
  console.log(`Reset the password of admin ${email.data}.\n`);
  const password = await askHidden(`New password (min ${env.PASSWORD_MIN_LENGTH} characters): `);
  const confirm = await askHidden('Repeat new password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');

  const logger = pino({ level: 'warn' });
  const db = createDatabase({ connectionString: env.DATABASE_URL, maxConnections: 1, logger });
  try {
    const { admin, revokedSessions } = await buildAdminAuthService(env, db, logger).resetPassword(
      email.data,
      password,
    );
    console.log(
      `\nPassword reset for ${admin.email} (${admin.role}). Signed out of ${revokedSessions} ` +
        `session(s). Audited as admin.password_reset.` +
        (admin.isActive ? '' : '\nNote: this account is deactivated; it still cannot sign in.'),
    );
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
