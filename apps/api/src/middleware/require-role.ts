import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';
import { getAdmin, type AdminPrincipal } from '../modules/auth/core/principals.js';

/** Mount after requireAdmin. Rejects admins whose role is not in `roles` with 403 FORBIDDEN. */
export function requireAdminRole(...roles: AdminPrincipal['role'][]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(getAdmin(req).role)) {
      throw new AppError(
        'FORBIDDEN',
        HTTP_STATUS.FORBIDDEN,
        'Your admin role cannot perform this action.',
      );
    }
    next();
  };
}
