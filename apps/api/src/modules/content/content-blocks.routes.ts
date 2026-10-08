import { Router } from 'express';
import type { ContentBlocksController } from './content-blocks.controller.js';

/** Mounted under /admin behind requireAdmin. Blocks are seeded; there is no create/delete. */
export function createContentBlocksRouter(controller: ContentBlocksController): Router {
  const router = Router();
  router.get('/content-blocks', controller.list);
  router.get('/content-blocks/:key', controller.get);
  router.put('/content-blocks/:key/translations/:lang', controller.updateTranslation);
  router.post('/content-blocks/:key/publish', controller.publish);
  router.post('/content-blocks/:key/unpublish', controller.unpublish);
  router.put('/content-blocks/:key/media', controller.setMedia);
  return router;
}
