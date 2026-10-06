import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { authRateLimit } from '../../middleware/auth-rate-limit.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { createAccessTokens } from '../auth/core/access-tokens.js';
import { createSessionsRepository } from '../auth/core/sessions.repository.js';
import { createSessionService } from '../auth/core/sessions.service.js';
import { createAdminAuthController } from './admin-auth.controller.js';
import { ADMIN_AUTH_PATH, createAdminAuthRouter } from './admin-auth.routes.js';
import { createAdminAuthService, type AdminAuthService } from './admin-auth.service.js';
import { createAdminUsersRepository } from './admin-users.repository.js';

const MS_PER_HOUR = 60 * 60 * 1000;
export const ADMIN_REFRESH_COOKIE = 'ui_admin_rt';

export interface AdminAuthModule {
  router: Router;
  /** Guard for every admin route (Phase 2+). */
  requireAdmin: RequestHandler;
  service: AdminAuthService;
}

export type AdminAuthEnv = Pick<
  Env,
  | 'JWT_ADMIN_ACCESS_SECRET'
  | 'JWT_ISSUER'
  | 'ACCESS_TOKEN_TTL_SECONDS'
  | 'ADMIN_REFRESH_TTL_HOURS'
  | 'AUTH_MAX_FAILED_LOGINS'
  | 'AUTH_LOCKOUT_MINUTES'
  | 'PASSWORD_MIN_LENGTH'
>;

/** Service only (no HTTP): shared by the module and the `admin:create` CLI. */
export function buildAdminAuthService(
  env: AdminAuthEnv,
  db: Database,
  logger: Logger,
): AdminAuthService {
  const repository = createAdminUsersRepository();
  return createAdminAuthService({
    db,
    repository,
    sessions: createSessionService({
      db,
      repository: createSessionsRepository(),
      logger,
      subjectType: 'admin',
      refreshTtlMs: env.ADMIN_REFRESH_TTL_HOURS * MS_PER_HOUR,
      isSubjectActive: (executor, id) => repository.isActive(executor, id),
    }),
    accessTokens: createAccessTokens({
      audience: 'admin',
      secret: env.JWT_ADMIN_ACCESS_SECRET,
      issuer: env.JWT_ISSUER,
      ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    }),
    lockoutPolicy: {
      maxFailedLogins: env.AUTH_MAX_FAILED_LOGINS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
    },
    passwordMinLength: env.PASSWORD_MIN_LENGTH,
  });
}

export interface AdminAuthModuleDeps {
  env: Env;
  db: Database;
  logger: Logger;
  basePath: string;
}

export function createAdminAuthModule({
  env,
  db,
  logger,
  basePath,
}: AdminAuthModuleDeps): AdminAuthModule {
  const service = buildAdminAuthService(env, db, logger);
  const controller = createAdminAuthController(service, {
    name: ADMIN_REFRESH_COOKIE,
    path: `${basePath}${ADMIN_AUTH_PATH}`,
    secure: env.COOKIE_SECURE,
  });
  const router = createAdminAuthRouter({
    controller,
    requireAdminAllowingPasswordChange: requireAdmin(service, {
      allowPasswordChangeRequired: true,
    }),
    strictLimit: () => authRateLimit(env),
  });
  return { router, requireAdmin: requireAdmin(service), service };
}
