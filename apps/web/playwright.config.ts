import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { resolveTestUrl } from './scripts/test-db';

/*
 * End-to-end tests run against their OWN stack so they never touch the development database:
 *   - API on :4010 using the *_test database (resolveTestUrl refuses any other name), a throwaway
 *     local media folder and a throwaway mock-email folder, seeded by scripts/e2e-seed.ts first;
 *   - the worker (sends the verification / reset emails from the outbox into the mock-email folder);
 *   - the web app, production build, on :3100 (flags off, the default);
 *   - a second build on :3101 with the Pidgin switcher and Body Scan entry point switched ON, for
 *     the *.flags.spec.ts tests.
 * global-teardown removes the seeded data again.
 */
const API_PORT = 4010;
const WEB_PORT = 3100;
const FLAGS_PORT = 3101;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
/** TEST ONLY shared secret between the e2e API and website. */
const REVALIDATE_SECRET = 'e2e-revalidate-secret-not-for-production-0001';
const FLAGS_URL = `http://localhost:${FLAGS_PORT}`;
const MEDIA_DIR = fileURLToPath(new URL('./e2e-media/', import.meta.url));
const MAIL_DIR = fileURLToPath(new URL('./e2e-mail/', import.meta.url));

// `pnpm lighthouse` reuses this stack (API, worker, flags-off web build) and runs tests/lighthouse.
const lighthouse = process.env.E2E_PROFILE === 'lighthouse';

const testDatabaseUrl = resolveTestUrl();

// Start from clean build folders: a stale BUILD_ID would let the second build start too early (see
// wait-for.mjs) and Next's on-disk data cache would serve products from an earlier run.
if (process.env.TEST_WORKER_INDEX === undefined) {
  for (const dir of ['.next-e2e', '.next-e2e-flags']) {
    rmSync(fileURLToPath(new URL(`./${dir}`, import.meta.url)), { recursive: true, force: true });
  }
}

const apiEnv = {
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: testDatabaseUrl,
  MEDIA_STORAGE_DRIVER: 'local',
  MEDIA_LOCAL_DIR: MEDIA_DIR,
  EMAIL_LOG_DIR: MAIL_DIR,
  EMAIL_OUTBOX_POLL_MS: '500',
  MEDIA_WORKER_POLL_MS: '500',
  API_PUBLIC_URL: API_URL,
  PUBLIC_WEB_URL: WEB_URL,
  CORS_ORIGINS: `${WEB_URL},${FLAGS_URL}`,
  BODY_SCAN_PROVIDER: 'mock',
  // The tests sign in and out many times from one address.
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  PUBLIC_RATE_LIMIT_MAX: '100000',
  CART_RATE_LIMIT_MAX: '100000',
  // The website's BFF is the one client of the API and forwards the real client address.
  TRUST_PROXY: '1',
  // Tells the website to refresh when media becomes ready (tests/e2e/revalidate.spec.ts).
  WEB_REVALIDATE_URL: `http://localhost:${WEB_PORT}/api/revalidate`,
  WEB_REVALIDATE_SECRET: REVALIDATE_SECRET,
};

const webEnv = {
  NODE_ENV: 'production',
  NEXT_ALLOW_LOCAL_MEDIA: 'true',
  API_BASE_URL: API_URL,
  NEXT_PUBLIC_API_BASE_URL: API_URL,
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: { trace: 'retain-on-failure' },
  projects: [
    ...(lighthouse
      ? [
          {
            name: 'lighthouse',
            testDir: './tests/lighthouse',
            use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
          },
        ]
      : []),
    {
      name: 'chromium',
      testIgnore: /\.flags\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL },
    },
    {
      name: 'flags',
      testMatch: /\.flags\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: FLAGS_URL },
    },
  ],
  webServer: [
    {
      // Seed first, then start the API on the test database.
      command: 'pnpm e2e:seed && pnpm --filter @urban-ibile/api dev',
      url: `${API_URL}/api/v1/site/config`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...apiEnv, PORT: String(API_PORT) },
    },
    {
      // Sends the account emails (outbox) into the mock-email folder the tests read.
      command: 'pnpm --filter @urban-ibile/api worker',
      wait: { stdout: /email outbox enabled/ },
      reuseExistingServer: false,
      timeout: 120_000,
      env: apiEnv,
    },
    {
      command: `pnpm build && pnpm exec next start -p ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        ...webEnv,
        NEXT_DIST_DIR: '.next-e2e',
        REVALIDATE_SECRET,
        NEXT_PUBLIC_SITE_URL: WEB_URL,
        NEXT_PUBLIC_ENABLE_PIDGIN: 'false',
        NEXT_PUBLIC_ENABLE_BODY_SCAN: 'false',
      },
    },
    // The flags build is only needed by the *.flags.spec.ts tests.
    ...(lighthouse
      ? []
      : [
          {
            command: `node scripts/wait-for.mjs .next-e2e/BUILD_ID && pnpm exec next build && pnpm exec next start -p ${FLAGS_PORT}`,
            url: FLAGS_URL,
            reuseExistingServer: false,
            timeout: 600_000,
            env: {
              ...webEnv,
              NEXT_DIST_DIR: '.next-e2e-flags',
              NEXT_PUBLIC_SITE_URL: FLAGS_URL,
              NEXT_PUBLIC_ENABLE_PIDGIN: 'true',
              NEXT_PUBLIC_ENABLE_BODY_SCAN: 'true',
              // TEST ONLY: one fake Pidgin key (not real Pidgin) to prove the per-key fallback.
              NEXT_PUBLIC_I18N_TEST_FIXTURE: 'true',
            },
          },
        ]),
  ],
});
