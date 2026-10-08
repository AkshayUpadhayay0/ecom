import { Router, type RequestHandler } from 'express';
import type { SettingsController } from './settings.controller.js';

export interface SettingsRouteDeps {
  controller: SettingsController;
  /** Changing settings is limited to super admins. */
  requireSuperAdmin: RequestHandler;
}

/** Mounted under /admin behind requireAdmin. */
export function createSettingsRouter({ controller, requireSuperAdmin }: SettingsRouteDeps): Router {
  const router = Router();
  router.get('/settings', controller.list);
  router.patch('/settings/:key', requireSuperAdmin, controller.update);
  return router;
}
