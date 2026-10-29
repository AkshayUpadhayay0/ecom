import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@urban-ibile/shared) to their TypeScript source.
const SOURCE_CONDITION = 'source';
const DEV_PORT = 5173; // must match CORS_ORIGINS in the API's .env

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: [SOURCE_CONDITION, ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
      externalConditions: [SOURCE_CONDITION],
    },
  },
  server: { port: DEV_PORT, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    // Full-app tests (real routes + MSW) type through whole forms; under parallel load a few take
    // longer than the 5 s default.
    testTimeout: 15_000,
    // Time-based tests (polling, debounce) need CPU when they fire: one worker per logical CPU
    // starved them on a 20-thread machine, so keep some headroom.
    maxWorkers: 6,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    server: { deps: { inline: [/@urban-ibile\//] } },
  },
});
