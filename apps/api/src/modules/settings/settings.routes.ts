import { Router, type RequestHandler } from 'express';
import { isAdminEditableSetting } from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { getAdmin } from '../auth/core/principals.js';
import type { SettingsController } from './settings.controller.js';

export interface SettingsRouteDeps {
  controller: SettingsController;
}

/**
 * Super admins may change every setting; a normal admin only the client-facing contact and
 * return-address settings (ADMIN_EDITABLE_SETTING_KEYS). Everything else is sensitive: 403.
 */
const requireSettingEditor: RequestHandler = (req, _res, next) => {
  const key = req.params.key;
  if (
    getAdmin(req).role !== 'super_admin' &&
    (typeof key !== 'string' || !isAdminEditableSetting(key))
  ) {
    throw new AppError(
      'FORBIDDEN',
      HTTP_STATUS.FORBIDDEN,
      'Only a super admin can change this setting.',
    );
  }
  next();
};

/** Mounted under /admin behind requireAdmin. */
export function createSettingsRouter({ controller }: SettingsRouteDeps): Router {
  const router = Router();
  router.get('/settings', controller.list);
  router.patch('/settings/:key', requireSettingEditor, controller.update);
  return router;
}
