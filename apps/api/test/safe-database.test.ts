import { describe, expect, it } from 'vitest';
import {
  assertSafeTestDatabase,
  describeDatabaseError,
  redactUrl,
  resolveTestDatabaseUrl,
} from './safe-database.js';

const SECRET = 'S3cret-Pg-Pass';

describe('test database URL', () => {
  it('uses TEST_DATABASE_URL when it is set', () => {
    expect(
      resolveTestDatabaseUrl({
        DATABASE_URL: `postgres://postgres:${SECRET}@localhost:5432/ecom`,
        TEST_DATABASE_URL: 'postgres://tester:other@db:5433/ecom_test',
      }),
    ).toEqual({ url: 'postgres://tester:other@db:5433/ecom_test', derived: false });
  });

  it('otherwise derives it from DATABASE_URL: same credentials, database <name>_test', () => {
    const resolved = resolveTestDatabaseUrl({
      DATABASE_URL: `postgres://postgres:${SECRET}@localhost:5432/ecom?sslmode=disable`,
      TEST_DATABASE_URL: '',
    });
    expect(resolved?.derived).toBe(true);
    const url = new URL(resolved?.url ?? '');
    expect(url.pathname).toBe('/ecom_test');
    expect(url.password).toBe(SECRET);
    expect(url.username).toBe('postgres');
    expect(url.host).toBe('localhost:5432');
    expect(url.searchParams.get('sslmode')).toBe('disable');
  });

  it('keeps a DATABASE_URL that already names a _test database', () => {
    expect(
      new URL(resolveTestDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h/shop_test' })?.url ?? '')
        .pathname,
    ).toBe('/shop_test');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveTestDatabaseUrl({})).toBeUndefined();
  });
});

describe('safety guard', () => {
  it.each(['ecom', 'ecom2', 'postgres', 'test_ecom', ''])('refuses database "%s"', (name) => {
    expect(() => {
      assertSafeTestDatabase(`postgres://u:p@localhost:5432/${name}`);
    }).toThrow(/must end in "_test"/);
  });

  it('accepts a database whose name ends in _test', () => {
    expect(() => {
      assertSafeTestDatabase('postgres://u:p@localhost:5432/ecom_test');
    }).not.toThrow();
  });
});

describe('error messages never show the password', () => {
  const resolved = {
    url: `postgres://postgres:${SECRET}@localhost:5432/ecom_test`,
    derived: false,
  };

  it('redacts the password', () => {
    expect(redactUrl(resolved.url)).toBe('postgres://postgres:****@localhost:5432/ecom_test');
  });

  it('explains an authentication failure with the steps to fix it', () => {
    const message = describeDatabaseError(
      { code: '28P01', message: 'password authentication failed' },
      resolved,
    );
    expect(message).not.toContain(SECRET);
    expect(message).toContain('postgres://postgres:****@localhost:5432/ecom_test');
    expect(message).toContain('from TEST_DATABASE_URL');
    expect(message).toMatch(/password in the URL must match the Postgres user's password/);
    expect(message).toMatch(/SAME user and password as DATABASE_URL/);
    expect(message).toMatch(/pnpm db:test:setup/);
  });

  it('explains a missing database and an unreachable server', () => {
    expect(describeDatabaseError({ code: '3D000' }, resolved)).toMatch(
      /does not exist yet[\s\S]*pnpm db:test:setup/,
    );
    expect(describeDatabaseError({ code: 'ECONNREFUSED' }, { ...resolved, derived: true })).toMatch(
      /derived from DATABASE_URL[\s\S]*could not be reached/,
    );
  });
});
