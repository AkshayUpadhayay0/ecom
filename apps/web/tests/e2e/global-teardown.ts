import { execSync } from 'node:child_process';

/** Removes the seeded e2e data from the test database (the script itself refuses non-_test names). */
export default function globalTeardown(): void {
  execSync('pnpm e2e:cleanup', { stdio: 'inherit' });
}
