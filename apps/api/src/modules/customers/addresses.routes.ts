import { Router, type RequestHandler } from 'express';
import type { AddressesController } from './addresses.controller.js';

export const ADDRESSES_PATH = '/me/addresses';

/** Customer's saved delivery details (own only). Mounted at ADDRESSES_PATH. */
export function createAddressesRouter(
  controller: AddressesController,
  requireCustomer: RequestHandler,
): Router {
  const router = Router();
  router.use(requireCustomer);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
