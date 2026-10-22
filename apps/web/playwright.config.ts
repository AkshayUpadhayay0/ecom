import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { resolveTestUrl } from './scripts/test-db';

/*
 * End-to-end tests run against their OWN stack so they never touch the development database:
 *   - API on :4010 using the *_test database (resolveTestUrl refuses any other name) and a throwaway
 *     local media folder, seeded by scripts/e2e-seed.ts before the API starts;
 *   - the web app, production build, on :3100.
 * global-teardown removes the seeded data again.
 */
const API_PORT = 4010;
const WEB_PORT = 3100;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const MEDIA_DIR = fileURLToPath(new URL('./e2e-media/', import.meta.url));

const testDatabaseUrl = resolveTestUrl();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Seed first, then start the API on the test database.
      command: 'pnpm e2e:seed && pnpm --filter @urban-ibile/api dev',
      url: `${API_URL}/api/v1/site/config`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        MEDIA_STORAGE_DRIVER: 'local',
        MEDIA_LOCAL_DIR: MEDIA_DIR,
        API_PUBLIC_URL: API_URL,
        CORS_ORIGINS: WEB_URL,
        PUBLIC_RATE_LIMIT_MAX: '100000',
      },
    },
    {
      command: `pnpm build && pnpm exec next start -p ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NODE_ENV: 'production',
        NEXT_ALLOW_LOCAL_MEDIA: 'true',
        NEXT_DIST_DIR: '.next-e2e',
        API_BASE_URL: API_URL,
        NEXT_PUBLIC_API_BASE_URL: API_URL,
        NEXT_PUBLIC_SITE_URL: WEB_URL,
        NEXT_PUBLIC_ENABLE_PIDGIN: 'false',
      },
    },
  ],
});
