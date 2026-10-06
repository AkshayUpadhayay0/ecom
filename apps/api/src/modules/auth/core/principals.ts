import type { Request } from 'express';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';

/** Authenticated customer (from a verified customer access token). */
export interface CustomerPrincipal {
  id: string;
  sessionId: string;
}

/** Authenticated admin (token verified AND session + account re-checked in the DB). */
export interface AdminPrincipal {
  id: string;
  sessionId: string;
  email: string;
  role: 'super_admin' | 'admin';
  mustChangePassword: boolean;
}

function missingPrincipal(): AppError {
  return new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
}

/** Use in handlers mounted behind requireCustomer. */
export function getCustomer(req: Request): CustomerPrincipal {
  if (!req.customer) throw missingPrincipal();
  return req.customer;
}

/** Use in handlers mounted behind requireAdmin. */
export function getAdmin(req: Request): AdminPrincipal {
  if (!req.admin) throw missingPrincipal();
  return req.admin;
}
