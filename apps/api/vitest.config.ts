import { defineConfig } from 'vitest/config';

// Resolve workspace packages (e.g. @urban-ibile/shared) to their TypeScript source, not a
// possibly stale dist/ build. Tests run in Vite's SSR mode, which has its own conditions.
const SOURCE_CONDITIONS = ['source'];

export default defineConfig({
  resolve: { conditions: SOURCE_CONDITIONS },
  ssr: { resolve: { conditions: SOURCE_CONDITIONS, externalConditions: SOURCE_CONDITIONS } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Integration tests share one Postgres test database; run files sequentially.
    fileParallelism: false,
    server: { deps: { inline: [/@urban-ibile\//] } },
  },
});
