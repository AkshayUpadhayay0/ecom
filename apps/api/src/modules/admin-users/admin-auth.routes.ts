import { Router, type RequestHandler } from 'express';
import type { AdminAuthController } from './admin-auth.controller.js';

export const ADMIN_AUTH_PATH = '/admin/auth';

export interface AdminAuthRouteDeps {
  controller: AdminAuthController;
  /** requireAdmin that still admits admins who must change their password. */
  requireAdminAllowingPasswordChange: RequestHandler;
  strictLimit: () => RequestHandler;
}

export function createAdminAuthRouter({
  controller,
  requireAdminAllowingPasswordChange,
  strictLimit,
}: AdminAuthRouteDeps): Router {
  const router = Router();
  router.post('/login', strictLimit(), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAdminAllowingPasswordChange, controller.getMe);
  router.post(
    '/change-password',
    strictLimit(),
    requireAdminAllowingPasswordChange,
    controller.changePassword,
  );
  return router;
}
