import { Router, type RequestHandler } from 'express';
import type { PublicCatalogController } from './public-catalog.controller.js';

export const PUBLIC_CATALOG_PATH = '/catalog';

/** Public storefront catalogue (no login). Mounted at PUBLIC_CATALOG_PATH. */
export function createPublicCatalogRouter(
  controller: PublicCatalogController,
  rateLimit: RequestHandler,
): Router {
  const router = Router();
  router.use(rateLimit);
  router.get('/products', controller.list);
  router.get('/products/:idOrSlug', controller.detail);
  router.get('/search', controller.search);
  router.get('/clothing-types', controller.clothingTypes);
  return router;
}
