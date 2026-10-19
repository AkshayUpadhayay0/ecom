import { Router, type RequestHandler } from 'express';
import type { MediaController } from './media.controller.js';

export interface MediaRouteDeps {
  controller: MediaController;
  /** Per-IP limit on creating upload URLs. */
  uploadLimit: RequestHandler;
  /** Media Library (browse all, private links, purge): super admins only. */
  requireSuperAdmin: RequestHandler;
}

/**
 * Admin media routes, mounted under /admin behind requireAdmin.
 * - Every admin (product form): create upload, complete, status, retry failed processing, and
 *   the picker. A normal admin only reaches public media no customer owns (service scope).
 * - super_admin (Media Library): browse everything, signed URLs (private files), purge.
 */
export function createMediaRouter({
  controller,
  uploadLimit,
  requireSuperAdmin,
}: MediaRouteDeps): Router {
  const router = Router();
  router.post('/media/uploads', uploadLimit, controller.createUpload);
  // Before /media/:id routes so "purge-retired" is not read as an id.
  router.post('/media/purge-retired', requireSuperAdmin, controller.purgeRetired);
  router.get('/media', requireSuperAdmin, controller.list);
  // Before /media/:id so "picker" is not read as an id.
  router.get('/media/picker', controller.picker);
  router.get('/media/:id', controller.get);
  router.get('/media/:id/url', requireSuperAdmin, controller.getUrl);
  router.post('/media/:id/complete', controller.completeUpload);
  router.post('/media/:id/retry', controller.retry);
  router.post('/media/:id/purge', requireSuperAdmin, controller.purge);
  return router;
}

export const CUSTOMER_MEDIA_PATH = '/me/media';

/**
 * Customer routes (mounted at CUSTOMER_MEDIA_PATH behind requireCustomer): private return
 * evidence uploads (own rate limit) and short-lived signed URLs for their own media.
 */
export function createCustomerMediaRouter(
  controller: MediaController,
  uploadLimit: RequestHandler,
): Router {
  const router = Router();
  router.post('/uploads', uploadLimit, controller.createCustomerUpload);
  router.post('/:id/complete', uploadLimit, controller.completeCustomerUpload);
  router.get('/:id/url', controller.getCustomerUrl);
  return router;
}
