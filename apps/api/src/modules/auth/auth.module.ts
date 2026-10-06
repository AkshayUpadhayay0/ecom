import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { authRateLimit } from '../../middleware/auth-rate-limit.js';
import { requireCustomer } from '../../middleware/require-customer.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import { createCustomerAuthController } from './auth.controller.js';
import { createAuthRepository } from './auth.repository.js';
import { CUSTOMER_AUTH_PATH, createCustomerAuthRouter } from './auth.routes.js';
import { createCustomerAuthService, type CustomerAuthService } from './auth.service.js';
import { createAccessTokens } from './core/access-tokens.js';
import { createSessionsRepository } from './core/sessions.repository.js';
import { createSessionService } from './core/sessions.service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CUSTOMER_REFRESH_COOKIE = 'ui_rt';

export interface CustomerAuthModule {
  router: Router;
  requireCustomer: RequestHandler;
  service: CustomerAuthService;
}

export interface CustomerAuthModuleDeps {
  env: Env;
  db: Database;
  logger: Logger;
  outbox: EmailOutboxRepository;
  /** Mount point of the v1 router, e.g. `/api/v1` (used for the cookie path). */
  basePath: string;
}

export function createCustomerAuthModule({
  env,
  db,
  logger,
  outbox,
  basePath,
}: CustomerAuthModuleDeps): CustomerAuthModule {
  const repository = createAuthRepository();
  const accessTokens = createAccessTokens({
    audience: 'customer',
    secret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const sessions = createSessionService({
    db,
    repository: createSessionsRepository(),
    logger,
    subjectType: 'customer',
    refreshTtlMs: env.CUSTOMER_REFRESH_TTL_DAYS * MS_PER_DAY,
    isSubjectActive: (executor, id) => repository.isCustomerActive(executor, id),
  });
  const service = createCustomerAuthService({
    db,
    repository,
    outbox,
    sessions,
    accessTokens,
    settings: env,
    logger,
  });
  const controller = createCustomerAuthController(service, {
    name: CUSTOMER_REFRESH_COOKIE,
    path: `${basePath}${CUSTOMER_AUTH_PATH}`,
    secure: env.COOKIE_SECURE,
  });
  const guard = requireCustomer(accessTokens);
  const authRouter = createCustomerAuthRouter({
    controller,
    requireCustomer: guard,
    strictLimit: () => authRateLimit(env),
  });

  // Mounted under CUSTOMER_AUTH_PATH by the caller.
  return { router: authRouter, requireCustomer: guard, service };
}
