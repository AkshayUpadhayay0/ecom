import { Router, type RequestHandler } from 'express';
import type { MediaController } from './media.controller.js';

export interface MediaRouteDeps {
  controller: MediaController;
  /** Per-IP limit on creating upload URLs. */
  uploadLimit: RequestHandler;
  /** Purging deletes stored files: super admins only. */
  requireSuperAdmin: RequestHandler;
}

/** Admin media routes, mounted under /admin behind requireAdmin. */
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
  router.get('/media/:id', controller.get);
  router.get('/media/:id/url', controller.getUrl);
  router.post('/media/:id/complete', controller.completeUpload);
  router.post('/media/:id/purge', requireSuperAdmin, controller.purge);
  return router;
}

export const CUSTOMER_MEDIA_PATH = '/me/media';

/** Customer routes (mounted at CUSTOMER_MEDIA_PATH behind requireCustomer). */
export function createCustomerMediaRouter(controller: MediaController): Router {
  const router = Router();
  router.get('/:id/url', controller.getCustomerUrl);
  return router;
}
