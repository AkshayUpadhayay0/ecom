import { Router } from 'express';
import type { InventoryController } from './inventory.controller.js';

/** Mounted under /admin behind requireAdmin. Stock changes ONLY via stock-adjustments. */
export function createInventoryRouter(controller: InventoryController): Router {
  const router = Router();
  router.get('/products/:productId/variants', controller.listVariants);
  router.post('/products/:productId/variants', controller.createVariant);
  router.patch('/variants/:id', controller.updateVariant);
  router.post('/variants/:id/stock-adjustments', controller.adjustStock);
  router.get('/variants/:id/stock-movements', controller.listMovements);
  router.get('/inventory/low-stock', controller.listLowStock);
  return router;
}
