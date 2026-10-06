import { describe, expect, it } from 'vitest';
import { hashPassword, passwordPolicyViolations, verifyPassword } from './passwords.js';

const POLICY = { email: 'ada.obi@example.com', minLength: 10 };

describe('password policy', () => {
  it('accepts a long, uncommon password', () => {
    expect(passwordPolicyViolations({ ...POLICY, password: 'Ankara-Velvet-2026!' })).toEqual([]);
  });

  it.each([
    ['too short', 'Short1!'],
    ['common (case-insensitive)', 'QwErTyUiOp'],
    ['contains the email local part', 'my-ada.obi-pass'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(passwordPolicyViolations({ ...POLICY, password })).not.toEqual([]);
  });
});

describe('argon2id hashing', () => {
  it('hashes with argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('Ankara-Velvet-2026!');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'Ankara-Velvet-2026!')).toBe(true);
    expect(await verifyPassword(hash, 'ankara-velvet-2026!')).toBe(false);
  });

  it('treats a malformed stored hash as a mismatch', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});
