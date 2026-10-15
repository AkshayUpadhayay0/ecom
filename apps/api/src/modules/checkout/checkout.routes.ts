import { Router, type RequestHandler } from 'express';
import type { CheckoutController } from './checkout.controller.js';

export const CHECKOUT_PATH = '/checkout';
export const DELIVERY_PATH = '/delivery';

interface CheckoutGuards {
  requireCustomer: RequestHandler;
  rateLimit: RequestHandler;
}

/** Quote + order creation (login required, own rate limit). Mounted at CHECKOUT_PATH. */
export function createCheckoutRouter(
  controller: CheckoutController,
  guards: CheckoutGuards,
): Router {
  const router = Router();
  router.use(guards.rateLimit, guards.requireCustomer);
  router.post('/quote', controller.quote);
  router.post('/orders', controller.createOrder);
  return router;
}

/** Orderable delivery zones (active, priced). Mounted at DELIVERY_PATH. */
export function createDeliveryRouter(
  controller: CheckoutController,
  requireCustomer: RequestHandler,
): Router {
  const router = Router();
  router.use(requireCustomer);
  router.get('/zones', controller.zones);
  return router;
}
