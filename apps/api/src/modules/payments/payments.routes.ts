import express, { Router, type RequestHandler } from 'express';
import type { PaymentsController } from './payments.controller.js';

export const PAYMENTS_PATH = '/payments';
export const PAYSTACK_WEBHOOK_PATH = '/webhooks/paystack';
const WEBHOOK_BODY_LIMIT = '256kb';

/** Customer payment routes (login + own rate limit). Mounted at PAYMENTS_PATH. */
export function createPaymentsRouter(
  controller: PaymentsController,
  guards: { requireCustomer: RequestHandler; rateLimit: RequestHandler },
): Router {
  const router = Router();
  router.post('/initialize', guards.rateLimit, guards.requireCustomer, controller.initialize);
  router.get('/verify', guards.rateLimit, guards.requireCustomer, controller.verify);
  return router;
}

/**
 * Paystack webhook. Mounted at the app level BEFORE the JSON parser: the HMAC is computed over
 * the raw bytes, so this route (and only this route) reads the body with express.raw().
 */
export function createPaystackWebhookRouter(
  controller: PaymentsController,
  rateLimit: RequestHandler,
): Router {
  const router = Router();
  router.post(
    '/',
    rateLimit,
    express.raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }),
    controller.webhook,
  );
  return router;
}
