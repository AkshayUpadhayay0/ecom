import type { Router, RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { apiRateLimit } from '../../middleware/rate-limit.js';
import { createCartRepository } from '../cart/cart.repository.js';
import { createIdempotencyRepository } from '../checkout/idempotency.repository.js';
import { createReservationsRepository } from '../inventory/reservations.repository.js';
import { createEmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import { createOrdersRepository } from '../orders/orders.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { createMockCheckoutRouter } from './mock-checkout.routes.js';
import {
  createPaymentConfirmationService,
  type PaymentConfirmationService,
} from './payment-confirmation.service.js';
import { createPaymentsController } from './payments.controller.js';
import { createPaymentsRepository } from './payments.repository.js';
import { createPaymentsRouter, createPaystackWebhookRouter } from './payments.routes.js';
import { createPaymentsService } from './payments.service.js';
import type { MockPaymentProvider } from './provider/mock-provider.js';
import type { PaymentProvider } from './provider/payment-provider.js';
import { createWebhookEventsRepository } from './webhook-events.repository.js';

export { MOCK_CHECKOUT_PATH } from './provider/mock-provider.js';
export { PAYMENTS_PATH, PAYSTACK_WEBHOOK_PATH } from './payments.routes.js';

/** The confirmation routine with its real repositories (API, worker and scripts share it). */
export function buildPaymentConfirmation(deps: {
  db: Database;
  logger: Logger;
  provider: PaymentProvider;
}): PaymentConfirmationService {
  return createPaymentConfirmationService({
    ...deps,
    payments: createPaymentsRepository(),
    orders: createOrdersRepository(),
    carts: createCartRepository(),
    reservations: createReservationsRepository(),
    outbox: createEmailOutboxRepository(),
  });
}

function isMockProvider(provider: PaymentProvider): provider is MockPaymentProvider {
  return provider.name === 'mock';
}

export interface PaymentsModule {
  router: Router;
  webhookRouter: Router;
  /** Only while the MOCK provider is in use (never in production). */
  mockCheckoutRouter: Router | undefined;
}

export function createPaymentsModule(deps: {
  env: Env;
  db: Database;
  logger: Logger;
  settings: SettingsService;
  provider: PaymentProvider;
  requireCustomer: RequestHandler;
}): PaymentsModule {
  const { env, db, logger, provider } = deps;
  const controller = createPaymentsController(
    createPaymentsService({
      db,
      logger,
      provider,
      payments: createPaymentsRepository(),
      orders: createOrdersRepository(),
      reservations: createReservationsRepository(),
      idempotency: createIdempotencyRepository(),
      webhookEvents: createWebhookEventsRepository(),
      confirmation: buildPaymentConfirmation({ db, logger, provider }),
      settings: deps.settings,
      callbackUrl: env.PAYSTACK_CALLBACK_URL,
    }),
  );
  return {
    router: createPaymentsRouter(controller, {
      requireCustomer: deps.requireCustomer,
      rateLimit: apiRateLimit({
        windowMs: env.PAYMENTS_RATE_LIMIT_WINDOW_MS,
        max: env.PAYMENTS_RATE_LIMIT_MAX,
      }),
    }),
    webhookRouter: createPaystackWebhookRouter(
      controller,
      apiRateLimit({ windowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS, max: env.WEBHOOK_RATE_LIMIT_MAX }),
    ),
    mockCheckoutRouter: isMockProvider(provider) ? createMockCheckoutRouter(provider) : undefined,
  };
}
