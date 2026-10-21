import { Router, type RequestHandler } from 'express';
import type { ContentBlocksController } from './content-blocks.controller.js';

/**
 * Mounted under /admin behind requireAdmin. Blocks are seeded (no create/delete). Text blocks are
 * edited in plain English text; resetting a block to its seeded default is a developer recovery
 * action (super_admin).
 */
export function createContentBlocksRouter(
  controller: ContentBlocksController,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();
  router.get('/content-blocks', controller.list);
  router.get('/content-blocks/:key', controller.get);
  router.post('/content-blocks/:key/publish', controller.publish);
  router.post('/content-blocks/:key/unpublish', controller.unpublish);
  router.put('/content-blocks/:key/media', controller.setMedia);
  router.put('/content-blocks/:key/text', controller.setText);
  router.post('/content-blocks/:key/reset', requireSuperAdmin, controller.resetText);
  return router;
}
