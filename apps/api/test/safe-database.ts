/** Database name integration tests and test tooling must never touch. */
const PROTECTED_DATABASE = 'ecom';

/** Throws unless `url` points at a database other than the main `ecom` database. */
export function assertSafeTestDatabase(url: string): void {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (name === '' || name === PROTECTED_DATABASE) {
    throw new Error(`TEST_DATABASE_URL must point at a separate test database, not "${name}".`);
  }
}
