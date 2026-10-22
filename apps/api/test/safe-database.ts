/*
 * Test database configuration (integration tests and `pnpm db:test:setup`).
 *
 * - TEST_DATABASE_URL if set; otherwise derived from DATABASE_URL by changing ONLY the database
 *   name to "<name>_test" (same server, user and password: both databases live on the same local
 *   Postgres server, so the credentials must be the same).
 * - Safety guard: the database name must end in "_test"; tests never touch the main database.
 * - Error messages name the URL with the password hidden. Passwords are never printed or logged.
 */

export const TEST_DATABASE_SUFFIX = '_test';

export interface ResolvedTestDatabase {
  url: string;
  /** true when derived from DATABASE_URL (TEST_DATABASE_URL was not set). */
  derived: boolean;
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** The test database URL, or undefined when neither variable is set. */
export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined>,
): ResolvedTestDatabase | undefined {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) return { url: explicit, derived: false };
  const main = env.DATABASE_URL?.trim();
  if (!main) return undefined;
  const url = new URL(main);
  const name = databaseNameOf(main);
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    url.pathname = `/${encodeURIComponent(`${name}${TEST_DATABASE_SUFFIX}`)}`;
  }
  return { url: url.toString(), derived: true };
}

/** Throws unless `url` points at a database whose name ends in "_test". */
export function assertSafeTestDatabase(url: string): void {
  const name = databaseNameOf(url);
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: the test database name must end in "${TEST_DATABASE_SUFFIX}" (e.g. ecom_test).`,
    );
  }
}

/** The URL with its password replaced, safe to print. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '<invalid database URL>';
  }
}

/** Postgres / network error codes we explain. */
const AUTH_FAILED = new Set(['28P01', '28000']);
const DATABASE_MISSING = '3D000';
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN']);

/**
 * A clear, password-free explanation of why connecting to the test database failed, with the
 * steps to fix it (Windows / pgAdmin wording).
 */
export function describeDatabaseError(error: unknown, resolved: ResolvedTestDatabase): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  const where = redactUrl(resolved.url);
  const source = resolved.derived
    ? 'derived from DATABASE_URL (TEST_DATABASE_URL is not set)'
    : 'from TEST_DATABASE_URL';
  const lines = [`Cannot connect to the test database ${where} (${source}).`];
  if (AUTH_FAILED.has(code)) {
    lines.push(
      'Postgres rejected the user name or password.',
      "The password in the URL must match the Postgres user's password. The test database lives on the",
      'same Postgres server as the main database, so use the SAME user and password as DATABASE_URL.',
      'Fix:',
      '  1. Open the repo-root .env file.',
      '  2. Either delete the TEST_DATABASE_URL line (it is then derived from DATABASE_URL), or make it',
      '     identical to DATABASE_URL except for the database name, e.g.',
      '     TEST_DATABASE_URL=postgres://postgres:<your postgres password>@localhost:5432/ecom_test',
      '  3. Run: pnpm db:test:setup   (creates ecom_test if missing and applies all migrations)',
    );
  } else if (code === DATABASE_MISSING) {
    lines.push(
      'The server is reachable but the test database does not exist yet.',
      'Fix: run  pnpm db:test:setup  (creates it and applies all migrations),',
      'or create it in pgAdmin (Databases > Create > Database..., name ecom_test) and then run that command.',
    );
  } else if (UNREACHABLE.has(code)) {
    lines.push(
      'The Postgres server could not be reached (host or port wrong, or the server is not running).',
      'Fix: start PostgreSQL (Windows: Services > postgresql-x64-16 > Start) and check host and port',
      'in the URL match DATABASE_URL.',
    );
  } else {
    lines.push(
      `Postgres error${code ? ` ${code}` : ''}: ${(error as Error | null)?.message ?? String(error)}`,
    );
  }
  return lines.join('\n');
}
