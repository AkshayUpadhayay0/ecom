// Runs against the static prototype served by scripts/serve.mjs. Uses the Playwright that is
// installed for apps/web:
//   cd apps/web && pnpm exec playwright test -c ../../docs/design-proposal/v3/tests/playwright.config.mjs
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: fileURLToPath(new URL('./results', import.meta.url)),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', testIgnore: /budget\.spec/, use: { ...devices['Desktop Chrome'] } },
    // The load-time budget runs alone, after everything else, so parallel tests cannot slow it down.
    { name: 'budget', testMatch: /budget\.spec/, dependencies: ['desktop'], fullyParallel: false, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    cwd: root,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
