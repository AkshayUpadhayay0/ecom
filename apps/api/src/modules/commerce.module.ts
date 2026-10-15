import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { Database } from '../db/database.js';
import { apiRateLimit } from '../middleware/rate-limit.js';
import { createCartController } from './cart/cart.controller.js';
import { createCartRepository } from './cart/cart.repository.js';
import { CART_PATH, createCartRouter } from './cart/cart.routes.js';
import { createCartService } from './cart/cart.service.js';
import { createCheckoutController } from './checkout/checkout.controller.js';
import {
  CHECKOUT_PATH,
  DELIVERY_PATH,
  createCheckoutRouter,
  createDeliveryRouter,
} from './checkout/checkout.routes.js';
import { createCheckoutService } from './checkout/checkout.service.js';
import { createIdempotencyRepository } from './checkout/idempotency.repository.js';
import { createAddressesController } from './customers/addresses.controller.js';
import { createAddressesRepository } from './customers/addresses.repository.js';
import { ADDRESSES_PATH, createAddressesRouter } from './customers/addresses.routes.js';
import { createAddressesService } from './customers/addresses.service.js';
import { createDeliveryZonesRepository } from './delivery/delivery-zones.repository.js';
import { createReservationsRepository } from './inventory/reservations.repository.js';
import {
  MY_ORDERS_PATH,
  createCustomerOrdersController,
  createCustomerOrdersRouter,
} from './orders/customer-orders.routes.js';
import { createCustomerOrdersService } from './orders/customer-orders.service.js';
import { createOrdersRepository } from './orders/orders.repository.js';
import type { SettingsService } from './settings/settings.service.js';

export interface CommerceModuleDeps {
  env: Env;
  db: Database;
  logger: Logger;
  settings: SettingsService;
  requireCustomer: RequestHandler;
}

/**
 * Customer commerce: addresses, cart, delivery zones, quote, checkout (stock reservation) and
 * order views. Payment is Phase 6. Returns one router mounted at the API root.
 */
export function createCommerceRouter({
  env,
  db,
  logger,
  settings,
  requireCustomer,
}: CommerceModuleDeps): Router {
  const zones = createDeliveryZonesRepository();
  const addressRows = createAddressesRepository();
  const addresses = createAddressesService({ db, repository: addressRows, zones });
  const carts = createCartRepository();
  const cart = createCartService({ db, repository: carts, settings });
  const orders = createOrdersRepository();
  const checkout = createCheckoutController(
    createCheckoutService({
      db,
      logger,
      cart,
      carts,
      addresses,
      addressRows,
      zones,
      orders,
      reservations: createReservationsRepository(),
      idempotency: createIdempotencyRepository(),
      settings,
    }),
  );

  const router = Router();
  router.use(
    ADDRESSES_PATH,
    createAddressesRouter(createAddressesController(addresses), requireCustomer),
  );
  router.use(
    CART_PATH,
    createCartRouter(createCartController(cart), {
      requireCustomer,
      rateLimit: apiRateLimit({
        windowMs: env.CART_RATE_LIMIT_WINDOW_MS,
        max: env.CART_RATE_LIMIT_MAX,
      }),
    }),
  );
  router.use(DELIVERY_PATH, createDeliveryRouter(checkout, requireCustomer));
  router.use(
    CHECKOUT_PATH,
    createCheckoutRouter(checkout, {
      requireCustomer,
      rateLimit: apiRateLimit({
        windowMs: env.CHECKOUT_RATE_LIMIT_WINDOW_MS,
        max: env.CHECKOUT_RATE_LIMIT_MAX,
      }),
    }),
  );
  router.use(
    MY_ORDERS_PATH,
    createCustomerOrdersRouter(
      createCustomerOrdersController(
        createCustomerOrdersService({ db, repository: orders, settings }),
      ),
      requireCustomer,
    ),
  );
  return router;
}
