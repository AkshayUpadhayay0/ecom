import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';

const VALID = { DATABASE_URL: 'postgres://u:p@localhost:5432/ecom' };

describe('parseEnv', () => {
  it('applies defaults and parses the CORS allow-list', () => {
    const env = parseEnv({ ...VALID, CORS_ORIGINS: 'http://a.test, http://b.test' });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('lists every invalid variable', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x', PORT: 'abc' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x', PORT: 'abc' })).toThrow(
      /DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/,
    );
  });

  it('rejects a CORS origin that is not a URL', () => {
    expect(() => parseEnv({ ...VALID, CORS_ORIGINS: 'not-a-url' })).toThrow(/CORS_ORIGINS/);
  });
});
