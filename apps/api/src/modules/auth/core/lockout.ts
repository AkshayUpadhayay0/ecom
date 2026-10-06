import type { Database } from '../../../db/database.js';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';
import {
  recordFailedLogin,
  recordSuccessfulLogin,
  type AccountTable,
  type LockoutPolicy,
} from './lockout.repository.js';
import { verifyAgainstDummyHash, verifyPassword } from './passwords.js';

export type { AccountTable, LockoutPolicy } from './lockout.repository.js';

export interface LoginAccount {
  id: string;
  passwordHash: string;
  lockedUntil: Date | null;
  isActive: boolean;
}

const MS_PER_SECOND = 1000;

export function invalidCredentials(): AppError {
  return new AppError(
    'INVALID_CREDENTIALS',
    HTTP_STATUS.UNAUTHORIZED,
    'Incorrect email or password.',
  );
}

function accountLocked(lockedUntil: Date): AppError {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / MS_PER_SECOND),
  );
  return new AppError(
    'ACCOUNT_LOCKED',
    HTTP_STATUS.TOO_MANY_REQUESTS,
    'Too many failed sign-in attempts. Try again later.',
    { retryAfterSeconds },
    { headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

/**
 * Checks a password with lockout. Unknown account, wrong password and inactive account all
 * produce the same INVALID_CREDENTIALS error (and similar timing). Locked accounts get
 * ACCOUNT_LOCKED with Retry-After.
 */
export async function verifyLoginWithLockout(
  db: Database,
  table: AccountTable,
  account: LoginAccount | undefined,
  password: string,
  policy: LockoutPolicy,
): Promise<void> {
  if (!account) {
    await verifyAgainstDummyHash(password);
    throw invalidCredentials();
  }
  if (account.lockedUntil !== null && account.lockedUntil.getTime() > Date.now()) {
    throw accountLocked(account.lockedUntil);
  }
  if (!(await verifyPassword(account.passwordHash, password))) {
    const lockedUntil = await recordFailedLogin(db, table, account.id, policy);
    if (lockedUntil !== null && lockedUntil.getTime() > Date.now()) {
      throw accountLocked(lockedUntil);
    }
    throw invalidCredentials();
  }
  if (!account.isActive) {
    throw invalidCredentials();
  }
  await recordSuccessfulLogin(db, table, account.id);
}
