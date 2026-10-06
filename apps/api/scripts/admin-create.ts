/**
 * Creates an admin account interactively. The password is typed with hidden input and is never
 * accepted as a command-line argument (it would end up in shell history).
 *
 *   pnpm admin:create
 */
import { createInterface } from 'node:readline/promises';
import { emailSchema } from '@urban-ibile/shared';
import { pino } from 'pino';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { AppError } from '../src/lib/errors.js';
import { buildAdminAuthService } from '../src/modules/admin-users/admin-auth.module.js';
import type { AdminRole } from '../src/modules/admin-users/admin-users.repository.js';

const CTRL_C = '\u0003';
const BACKSPACE_CODES = new Set(['\u0008', '\u007f']);
const ENTER_CODES = new Set(['\r', '\n']);
const ROLES: readonly AdminRole[] = ['admin', 'super_admin'];
const MAX_DISPLAY_NAME = 120;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it. Falls back to a plain read when stdin is not a terminal. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return ask(question);
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === CTRL_C) {
          finish(new Error('Cancelled.'));
          return;
        }
        if (ENTER_CODES.has(char)) {
          finish();
          return;
        }
        if (BACKSPACE_CODES.has(char)) {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

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
