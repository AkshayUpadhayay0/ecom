import { fileURLToPath } from 'node:url';

/**
 * Test-database resolution shared by the e2e seed script and the Playwright config.
 * Never returns a database whose name does not end in "_test".
 */
const TEST_SUFFIX = '_test';
const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function resolveTestUrl(): string {
  try {
    process.loadEnvFile(ROOT_ENV);
  } catch {
    // No root .env: rely on the process environment.
  }
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  let url = explicit;
  if (!url) {
    const main = process.env.DATABASE_URL?.trim();
    if (!main) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before seeding.');
    const parsed = new URL(main);
    const name = databaseName(main);
    parsed.pathname = `/${encodeURIComponent(name.endsWith(TEST_SUFFIX) ? name : `${name}${TEST_SUFFIX}`)}`;
    url = parsed.toString();
  }
  const name = databaseName(url);
  if (!name.endsWith(TEST_SUFFIX)) {
    throw new Error(`Refusing to seed "${name}": the database name must end in "${TEST_SUFFIX}".`);
  }
  return url;
}
