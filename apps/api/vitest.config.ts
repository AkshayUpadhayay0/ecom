import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolve workspace packages (e.g. @urban-ibile/shared) to their TypeScript source.
    conditions: ['source'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Integration tests share one Postgres test database; run files sequentially.
    fileParallelism: false,
  },
});
