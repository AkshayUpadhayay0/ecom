import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { resolveTestDatabaseUrl } from './safe-database.js';

// Load TEST_DATABASE_URL etc. from the repo-root `.env` (already-set variables win).
loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
process.env.NODE_ENV = 'test';
// Without TEST_DATABASE_URL, use DATABASE_URL with the database name changed to "<name>_test".
const resolved = resolveTestDatabaseUrl(process.env);
if (resolved) process.env.TEST_DATABASE_URL = resolved.url;
