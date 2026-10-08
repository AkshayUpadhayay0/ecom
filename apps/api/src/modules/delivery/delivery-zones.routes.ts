import { Router } from 'express';
import type { DeliveryZonesController } from './delivery-zones.controller.js';

/** Mounted under /admin behind requireAdmin. No DELETE: zones are deactivated. */
export function createDeliveryZonesRouter(controller: DeliveryZonesController): Router {
  const router = Router();
  router.get('/delivery-zones', controller.list);
  router.post('/delivery-zones', controller.create);
  router.get('/delivery-zones/:id', controller.get);
  router.patch('/delivery-zones/:id', controller.update);
  return router;
}
