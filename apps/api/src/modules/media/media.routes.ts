import { Router, type RequestHandler } from 'express';
import type { MediaController } from './media.controller.js';

export interface MediaRouteDeps {
  controller: MediaController;
  /** Per-IP limit on creating upload URLs. */
  uploadLimit: RequestHandler;
  /** Physical purge of stored files: super admins only. */
  requireSuperAdmin: RequestHandler;
}

/**
 * Admin media routes, mounted under /admin behind requireAdmin (decision 22 Oct 2026).
 * - Every admin (Media Library + product form): browse, detail, preview URL, usage, upload,
 *   complete, retry, picker and delete (detach + retire). For BOTH roles these only reach public
 *   media that no customer owns: private files / return evidence are never listed and are 404 by
 *   id (evidence is reachable only through the return request routes).
 * - super_admin: physical purge of retired files (purge, purge-retired).
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
  router.get('/media', controller.list);
  // Before /media/:id so "picker" is not read as an id.
  router.get('/media/picker', controller.picker);
  router.get('/media/:id', controller.get);
  router.get('/media/:id/url', controller.getUrl);
  router.post('/media/:id/complete', controller.completeUpload);
  router.post('/media/:id/retry', controller.retry);
  // Delete = detach everywhere + retire (files kept until a super admin purges them).
  router.get('/media/:id/usage', controller.usage);
  router.delete('/media/:id', controller.remove);
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
