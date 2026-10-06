import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Load TEST_DATABASE_URL etc. from the repo-root `.env` (already-set variables win).
loadDotenv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
process.env.NODE_ENV = 'test';
