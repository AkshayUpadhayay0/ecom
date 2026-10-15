import { Router, type RequestHandler } from 'express';
import type { CartController } from './cart.controller.js';

export const CART_PATH = '/cart';

/** The customer's single active cart (shared by web and mobile). Mounted at CART_PATH. */
export function createCartRouter(
  controller: CartController,
  guards: { requireCustomer: RequestHandler; rateLimit: RequestHandler },
): Router {
  const router = Router();
  router.use(guards.rateLimit, guards.requireCustomer);
  router.get('/', controller.get);
  router.post('/items', controller.addItem);
  router.patch('/items/:id', controller.updateQuantity);
  router.delete('/items/:id', controller.removeLine);
  router.put('/items/:id/decision', controller.replaceDecision);
  return router;
}
