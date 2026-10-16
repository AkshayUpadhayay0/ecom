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

/** Mounted under /admin. Reading for every admin; resolving (money decisions) super_admin only. */
export function createPaymentReviewsRouter(deps: {
  controller: PaymentReviewsController;
  requireSuperAdmin: RequestHandler;
}): Router {
  const router = Router();
  router.get('/payment-reviews', deps.controller.list);
  router.get(`/payment-reviews/:${PAYMENT_ID}`, deps.controller.get);
  router.post(
    `/payment-reviews/:${PAYMENT_ID}/resolve`,
    deps.requireSuperAdmin,
    deps.controller.resolve,
  );
  return router;
}
