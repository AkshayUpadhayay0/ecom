import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';
import { TEST_SECRETS } from './helpers.js';

const VALID = { DATABASE_URL: 'postgres://u:p@localhost:5432/ecom', ...TEST_SECRETS };

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
    expect(parseEnv({ ...VALID, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv(VALID).COOKIE_SECURE).toBe(false);
  });
});
