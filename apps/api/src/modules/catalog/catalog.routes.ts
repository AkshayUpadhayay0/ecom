import { Router, type RequestHandler } from 'express';
import type { CatalogController } from './catalog.controller.js';

/**
 * Admin catalog routes, mounted under /admin behind requireAdmin. Clothing types are deactivated;
 * products are archived or soft-deleted (DELETE marks deleted_at, never removes the row). Sizes are seeded with the size charts,
 * so the admin can only list and reorder them. Listing sizes is open to every admin (variants and
 * the product form need the names); reordering belongs to Sizes & Charts (super_admin).
 */
export function createCatalogRouter(
  controller: CatalogController,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();

  router.get('/clothing-types', controller.listClothingTypes);
  router.post('/clothing-types', controller.createClothingType);
  router.get('/clothing-types/:id', controller.getClothingType);
  router.patch('/clothing-types/:id', controller.updateClothingType);

  router.get('/sizes', controller.listSizes);
  // Before /sizes/:id so "order" is not read as an id.
  router.put('/sizes/order', requireSuperAdmin, controller.reorderSizes);
  router.get('/sizes/:id', controller.getSize);

  router.get('/products', controller.listProducts);
  router.post('/products', controller.createProduct);
  router.get('/products/:id', controller.getProduct);
  router.patch('/products/:id', controller.updateProduct);
  router.post('/products/:id/status', controller.changeProductStatus);
  router.put('/products/:id/video', controller.setProductVideo);
  router.put('/products/:id/images', controller.setProductImages);
  // Soft delete (every admin): history keeps its copy; blocked while business is still open.
  router.delete('/products/:id', controller.deleteProduct);

  return router;
}
