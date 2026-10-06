import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { Database } from './db/database.js';
import { corsAllowList } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { createHealthController } from './modules/health/health.controller.js';
import { createHealthRepository } from './modules/health/health.repository.js';
import { HEALTH_PATH, createHealthRouter } from './modules/health/health.routes.js';
import { createHealthService } from './modules/health/health.service.js';

export const API_BASE_PATH = '/api/v1';
const JSON_BODY_LIMIT = '100kb';

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Database;
}

/** Builds the Express app. Has no side effects (no listen), so tests can use it directly. */
export function createApp({ env, logger, db }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowList(env.CORS_ORIGINS));

  const v1 = express.Router();
  v1.use(
    apiRateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      skipPaths: [HEALTH_PATH],
    }),
  );
  // NOTE (Phase 6): the Paystack webhook route needs the raw body and must be mounted
  // with express.raw() BEFORE this JSON parser.
  v1.use(express.json({ limit: JSON_BODY_LIMIT }));

  const healthService = createHealthService({
    repository: createHealthRepository(db),
    dbTimeoutMs: env.DB_HEALTH_TIMEOUT_MS,
  });
  v1.use(createHealthRouter(createHealthController(healthService)));

  app.use(API_BASE_PATH, v1);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
