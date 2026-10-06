import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** 256-bit random token for refresh / email-verification / password-reset links. */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Only this hash is stored. SHA-256 (not argon2) is sufficient because the token is random
 * with 256 bits of entropy; it also allows a direct indexed lookup.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
