// Runs Lighthouse (mobile, simulated slow 4G: the Lighthouse default) against the seeded e2e stack:
//   pnpm --filter @urban-ibile/web lighthouse
// It starts the same API + worker + production web build as the e2e tests (test database only),
// audits the pages in tests/lighthouse/lighthouse.spec.ts, prints the scores and fails when
// accessibility is below 100 or performance below 85. Foreground only.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--project=lighthouse', '--workers=1', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, E2E_PROFILE: 'lighthouse', MEDIA_STORAGE_DRIVER: 'local' },
  },
);
process.exit(result.status ?? 1);
