import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';
import { dictionary } from '@zxcvbn-ts/language-common';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';

// `Algorithm` is a const enum, which isolatedModules cannot inline; 2 = Argon2id.
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- see comment above
const ARGON2ID = 2 as Algorithm;

/** OWASP Password Storage Cheat Sheet baseline for argon2id (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Ranked list of ~49k leaked passwords (MIT, @zxcvbn-ts/language-common).
const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  dictionary['passwords-common'].map((password) => password.toLowerCase()),
);
const MIN_EMAIL_PART_LENGTH = 3;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed stored hash: treat as a mismatch, never as a success.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real verification so "unknown email" and "wrong password" cannot
 * be told apart by response time.
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
}

export interface PasswordPolicyInput {
  password: string;
  email: string;
  minLength: number;
}

/** Returns human-readable reasons the password is rejected (empty = acceptable). */
export function passwordPolicyViolations({
  password,
  email,
  minLength,
}: PasswordPolicyInput): string[] {
  const reasons: string[] = [];
  const lowered = password.toLowerCase();
  if (password.length < minLength) {
    reasons.push(`Use at least ${minLength} characters.`);
  }
  if (COMMON_PASSWORDS.has(lowered)) {
    reasons.push('This password is too common.');
  }
  const emailLocalPart = email.toLowerCase().split('@')[0] ?? '';
  if (emailLocalPart.length >= MIN_EMAIL_PART_LENGTH && lowered.includes(emailLocalPart)) {
    reasons.push('Do not include your email address in the password.');
  }
  return reasons;
}

export function assertPasswordAllowed(input: PasswordPolicyInput): void {
  const reasons = passwordPolicyViolations(input);
  if (reasons.length > 0) {
    throw new AppError('WEAK_PASSWORD', HTTP_STATUS.BAD_REQUEST, 'Choose a stronger password.', {
      reasons,
    });
  }
}
