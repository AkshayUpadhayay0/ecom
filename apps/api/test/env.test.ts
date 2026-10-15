import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';
import { TEST_SECRETS } from './helpers.js';

const VALID = { DATABASE_URL: 'postgres://u:p@localhost:5432/ecom', ...TEST_SECRETS };
/** Fake R2 settings (never real keys). */
const R2 = {
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key-id',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_PUBLIC_BUCKET: 'ui-public',
  R2_PRIVATE_BUCKET: 'ui-private',
  R2_PUBLIC_BASE_URL: 'https://media.example.com',
};
const PRODUCTION = { ...VALID, ...R2, NODE_ENV: 'production', MEDIA_STORAGE_DRIVER: 'r2' };

describe('parseEnv', () => {
  it('applies defaults and parses the CORS allow-list', () => {
    const env = parseEnv({ ...VALID, CORS_ORIGINS: 'http://a.test, http://b.test' });

    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('lists every invalid variable', () => {
    expect(() => parseEnv({ ...VALID, DATABASE_URL: 'mysql://x', PORT: 'abc' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...VALID, DATABASE_URL: 'mysql://x', PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects a CORS origin that is not a URL', () => {
    expect(() => parseEnv({ ...VALID, CORS_ORIGINS: 'not-a-url' })).toThrow(/CORS_ORIGINS/);
  });

  it('fails when a JWT secret is missing', () => {
    const { JWT_ACCESS_SECRET: _omit, ...rest } = VALID;
    expect(() => parseEnv(rest)).toThrow(/JWT_ACCESS_SECRET: is required/);
  });

  it('fails when a JWT secret is too short', () => {
    expect(() => parseEnv({ ...VALID, JWT_ADMIN_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ADMIN_ACCESS_SECRET: must be at least 32 characters/,
    );
  });

  it('fails when customer and admin secrets are the same', () => {
    expect(() => parseEnv({ ...VALID, JWT_ADMIN_ACCESS_SECRET: VALID.JWT_ACCESS_SECRET })).toThrow(
      /JWT_ADMIN_ACCESS_SECRET: must differ/,
    );
  });

  it('forces secure cookies in production', () => {
    expect(parseEnv({ ...PRODUCTION }).COOKIE_SECURE).toBe(true);
    expect(parseEnv(VALID).COOKIE_SECURE).toBe(false);
  });

  it('uses local media storage by default and refuses it in production', () => {
    expect(parseEnv(VALID).MEDIA_STORAGE_DRIVER).toBe('local');
    expect(() => parseEnv({ ...VALID, NODE_ENV: 'production' })).toThrow(
      /MEDIA_STORAGE_DRIVER: must be 'r2' in production/,
    );
  });

  it('refuses the MOCK Body Scan provider in production', () => {
    expect(parseEnv(VALID).BODY_SCAN_PROVIDER).toBe('none');
    expect(() => parseEnv({ ...PRODUCTION, BODY_SCAN_PROVIDER: 'mock' })).toThrow(
      /BODY_SCAN_PROVIDER: the MOCK Body Scan provider cannot be used in production/,
    );
  });

  it('requires every R2 variable when the r2 driver is selected', () => {
    const { R2_PRIVATE_BUCKET: _omit, ...partial } = R2;
    expect(() => parseEnv({ ...VALID, ...partial, MEDIA_STORAGE_DRIVER: 'r2' })).toThrow(
      /R2_PRIVATE_BUCKET: is required when MEDIA_STORAGE_DRIVER is 'r2'/,
    );
    expect(parseEnv({ ...VALID, ...R2, MEDIA_STORAGE_DRIVER: 'r2' }).R2_PUBLIC_BUCKET).toBe(
      'ui-public',
    );
  });
});
