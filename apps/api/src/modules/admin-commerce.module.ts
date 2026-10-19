import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../db/database.js';
import { createSessionsRepository } from './auth/core/sessions.repository.js';
import { createCartRepository } from './cart/cart.repository.js';
import { createAdminCustomersRepository } from './customers/admin-customers.repository.js';
import {
  createAdminCustomersController,
  createAdminCustomersRouter,
} from './customers/admin-customers.routes.js';
import { createAdminCustomersService } from './customers/admin-customers.service.js';
import { createReservationsRepository } from './inventory/reservations.repository.js';
import { createEmailOutboxRepository } from './notifications/email-outbox.repository.js';
import { createAdminOrdersRepository } from './orders/admin-orders.repository.js';
import {
  createAdminOrdersController,
  createAdminOrdersRouter,
} from './orders/admin-orders.routes.js';
import { createAdminOrdersService } from './orders/admin-orders.service.js';
import { createOrderNotesRepository } from './orders/order-notes.repository.js';
import { createOrdersRepository } from './orders/orders.repository.js';
import { createPaymentReviewsRepository } from './payments/payment-reviews.repository.js';
import {
  createPaymentReviewsController,
  createPaymentReviewsRouter,
} from './payments/payment-reviews.routes.js';
import { createPaymentReviewsService } from './payments/payment-reviews.service.js';
import { createPaymentsRepository } from './payments/payments.repository.js';
import type { SettingsService } from './settings/settings.service.js';
import { createStatsRepository } from './stats/stats.repository.js';
import { createStatsController, createStatsRouter } from './stats/stats.routes.js';
import { createStatsService } from './stats/stats.service.js';

const MS_PER_SECOND = 1000;

/**
 * Admin order management, payment review queue, customer lookup and dashboard stats (Phase 7a).
 * Mounted inside the admin router (behind requireAdmin).
 */
export function createAdminCommerceRouter(deps: {
  db: Database;
  logger: Logger;
  settings: SettingsService;
  requireSuperAdmin: RequestHandler;
  statsCacheSeconds: number;
}): Router {
  const { db, logger, settings, requireSuperAdmin } = deps;
  const orders = createOrdersRepository();
  const reservations = createReservationsRepository();
  const outbox = createEmailOutboxRepository();
  const reviews = createPaymentReviewsRepository();

  const router = Router();
  router.use(
    createAdminOrdersRouter(
      createAdminOrdersController(
        createAdminOrdersService({
          db,
          logger,
          repository: createAdminOrdersRepository(),
          orders,
          notes: createOrderNotesRepository(),
          reservations,
          payments: createPaymentsRepository(),
          reviews,
          outbox,
          settings,
        }),
      ),
    ),
  );
  router.use(
    createPaymentReviewsRouter({
      controller: createPaymentReviewsController(
        createPaymentReviewsService({
          db,
          logger,
          reviews,
          orders,
          carts: createCartRepository(),
          reservations,
          outbox,
          settings,
        }),
      ),
    }),
  );
  router.use(
    createAdminCustomersRouter({
      controller: createAdminCustomersController(
        createAdminCustomersService({
          db,
          logger,
          repository: createAdminCustomersRepository(),
          sessions: createSessionsRepository(),
          settings,
        }),
      ),
      requireSuperAdmin,
    }),
  );
  router.use(
    createStatsRouter(
      createStatsController(
        createStatsService({
          db,
          repository: createStatsRepository(),
          reviews,
          settings,
          cacheMs: deps.statsCacheSeconds * MS_PER_SECOND,
        }),
      ),
    ),
  );
  return router;
}
