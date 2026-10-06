import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';
import { readBearerToken } from '../modules/auth/core/access-tokens.js';
import type { AdminAuthService } from '../modules/admin-users/admin-auth.service.js';

export interface RequireAdminOptions {
  /** Let admins who must change their password through (only /me, change-password). */
  allowPasswordChangeRequired?: boolean;
}

/**
 * Requires a valid ADMIN access token. Customer tokens fail (different secret + audience).
 * Unlike requireCustomer this also checks the DB: the session family must be live and the
 * admin active, so logout / deactivation take effect immediately (1-2 admins: cheap).
 */
export function requireAdmin(
  service: AdminAuthService,
  options: RequireAdminOptions = {},
): RequestHandler {
  return async (req, _res, next) => {
    const token = readBearerToken(req.get('authorization'));
    if (token === undefined) {
      throw new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
    }
    const admin = await service.authenticate(token);
    if (admin.mustChangePassword && options.allowPasswordChangeRequired !== true) {
      throw new AppError(
        'PASSWORD_CHANGE_REQUIRED',
        HTTP_STATUS.FORBIDDEN,
        'Change your password to continue.',
      );
    }
    req.admin = admin;
    next();
  };
}
