import { Router, type RequestHandler } from 'express';
import { listPaymentReviewsQuerySchema, resolvePaymentReviewSchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { PaymentReviewsService } from './payment-reviews.service.js';

const PAYMENT_ID = 'paymentId';

export interface PaymentReviewsController {
  list: RequestHandler;
  get: RequestHandler;
  resolve: RequestHandler;
}

export function createPaymentReviewsController(
  service: PaymentReviewsService,
): PaymentReviewsController {
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listPaymentReviewsQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req, PAYMENT_ID)));
    },
    resolve: async (req, res) => {
      const paymentId = uuidParam(req, PAYMENT_ID);
      const input = resolvePaymentReviewSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.resolve(auditActorOf(req), paymentId, input));
    },
  };
}

/**
 * Mounted under /admin. Every admin role may read and resolve (decision 19 Oct 2026: the
 * client's staff make these business decisions); a note is required and every resolution is
 * audited.
 */
export function createPaymentReviewsRouter(deps: { controller: PaymentReviewsController }): Router {
  const router = Router();
  router.get('/payment-reviews', deps.controller.list);
  router.get(`/payment-reviews/:${PAYMENT_ID}`, deps.controller.get);
  router.post(`/payment-reviews/:${PAYMENT_ID}/resolve`, deps.controller.resolve);
  return router;
}
