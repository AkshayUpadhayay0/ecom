import { Router } from 'express';
import type { CatalogController } from './catalog.controller.js';

/**
 * Admin catalog routes, mounted under /admin behind requireAdmin. There are no DELETE routes:
 * clothing types, sizes and garment cuts are deactivated; products are archived.
 */
export function createCatalogRouter(controller: CatalogController): Router {
  const router = Router();

  router.get('/clothing-types', controller.listClothingTypes);
  router.post('/clothing-types', controller.createClothingType);
  router.get('/clothing-types/:id', controller.getClothingType);
  router.patch('/clothing-types/:id', controller.updateClothingType);

  router.get('/sizes', controller.listSizes);
  router.post('/sizes', controller.createSize);
  // Before /sizes/:id so "order" is not read as an id.
  router.put('/sizes/order', controller.reorderSizes);
  router.get('/sizes/:id', controller.getSize);
  router.patch('/sizes/:id', controller.updateSize);

  router.get('/garment-cuts', controller.listGarmentCuts);
  router.post('/garment-cuts', controller.createGarmentCut);
  router.get('/garment-cuts/:id', controller.getGarmentCut);
  router.patch('/garment-cuts/:id', controller.updateGarmentCut);

  router.get('/products', controller.listProducts);
  router.post('/products', controller.createProduct);
  router.get('/products/:id', controller.getProduct);
  router.patch('/products/:id', controller.updateProduct);
  router.post('/products/:id/status', controller.changeProductStatus);
  router.put('/products/:id/video', controller.setProductVideo);

  return router;
}
