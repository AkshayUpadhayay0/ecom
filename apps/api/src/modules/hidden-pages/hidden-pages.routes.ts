import { Router, type RequestHandler } from 'express';
import type {
  HiddenPagesAdminController,
  HiddenPagesController,
} from './hidden-pages.controller.js';

export const HIDDEN_PAGES_PATH = '/hidden-pages';

export interface HiddenPagesRouteDeps {
  controller: HiddenPagesController;
  /** Sets req.customer when a customer token is sent (grants also remember the account). */
  optionalCustomer: RequestHandler;
  /** Per-IP and per-page limits on unlock attempts. */
  unlockLimits: RequestHandler[];
}

/**
 * Public routes, mounted at /hidden-pages. A route token identifies the page (it is printed in
 * the QR code and is not a secret); only a valid serial unlocks it. Pages are never listed.
 */
export function createHiddenPagesRouter(deps: HiddenPagesRouteDeps): Router {
  const router = Router();
  router.get('/:routeToken', deps.optionalCustomer, deps.controller.getState);
  router.get('/:routeToken/content', deps.optionalCustomer, deps.controller.getContent);
  router.post(
    '/:routeToken/unlock',
    ...deps.unlockLimits,
    deps.optionalCustomer,
    deps.controller.unlock,
  );
  return router;
}

/**
 * Admin routes, mounted under /admin behind requireAdmin. Internal tool: super_admin only (the
 * client supplies the write-ups; developers apply them). Slugs/route tokens are read-only.
 * The guard is per route: a router-level use() would also run for every later admin route.
 */
export function createHiddenPagesAdminRouter(
  controller: HiddenPagesAdminController,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();
  router.get('/hidden-pages', requireSuperAdmin, controller.list);
  router.get('/hidden-pages/:id', requireSuperAdmin, controller.get);
  router.put('/hidden-pages/:id/content', requireSuperAdmin, controller.updateContent);
  return router;
}
