import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SERIAL_MAX_LENGTH } from '@urban-ibile/shared';

/** Serials of at least this length show their last HINT_VISIBLE_CHARS characters to admins. */
const HINT_MIN_LENGTH = 8;
const HINT_VISIBLE_CHARS = 4;
const HINT_MASK = '****';
/** Random bytes in the hidden-page browser cookie. */
const BROWSER_TOKEN_BYTES = 32;

/**
 * Serial input tolerance (team decision, open): trim surrounding whitespace only. Everything else
 * must match exactly (no case folding, no prefix rules).
 */
export function normalizeSerial(raw: string): string | undefined {
  const serial = raw.trim();
  return serial.length === 0 || serial.length > SERIAL_MAX_LENGTH ? undefined : serial;
}

export interface SerialHasher {
  /** HMAC-SHA256(serial, SERIAL_HMAC_SECRET), hex. The only form of a serial ever stored. */
  hash(serial: string): string;
}

export function createSerialHasher(secret: string): SerialHasher {
  return {
    hash: (serial) => createHmac('sha256', secret).update(serial, 'utf8').digest('hex'),
  };
}

/** Masked display value for admins, e.g. `****4821`. Short serials are fully masked. */
export function serialHint(serial: string): string {
  return serial.length >= HINT_MIN_LENGTH
    ? `${HINT_MASK}${serial.slice(-HINT_VISIBLE_CHARS)}`
    : HINT_MASK;
}

/** New random value for the visitor's HttpOnly cookie. */
export function newBrowserToken(): string {
  return randomBytes(BROWSER_TOKEN_BYTES).toString('base64url');
}

/** Only this hash of the cookie value is stored (page_access_grants.browser_token_hash). */
export function hashBrowserToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
