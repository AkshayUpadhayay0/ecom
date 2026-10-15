import type { RequestHandler } from 'express';
import {
  IDEMPOTENCY_HEADER,
  checkoutSchema,
  idempotencyKeySchema,
  quoteSchema,
} from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { bodyOf, sendData } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { CheckoutService } from './checkout.service.js';

export interface CheckoutController {
  zones: RequestHandler;
  quote: RequestHandler;
  createOrder: RequestHandler;
}

function idempotencyKeyOf(header: string | undefined): string {
  const result = idempotencyKeySchema.safeParse(header);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Request validation failed.', {
      issues: [
        {
          path: IDEMPOTENCY_HEADER,
          message: 'Send a unique Idempotency-Key header (8-128 characters).',
        },
      ],
    });
  }
  return result.data;
}

export function createCheckoutController(service: CheckoutService): CheckoutController {
  return {
    zones: async (_req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.zones());
    },
    quote: async (req, res) => {
      const input = quoteSchema.parse(bodyOf(req));
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.quote(getCustomer(req).id, input));
    },
    createOrder: async (req, res) => {
      const key = idempotencyKeyOf(req.get(IDEMPOTENCY_HEADER));
      const input = checkoutSchema.parse(bodyOf(req));
      const result = await service.createOrder(getCustomer(req).id, key, input);
      res.set('Cache-Control', 'no-store');
      sendData(res, result.created ? HTTP_STATUS.CREATED : HTTP_STATUS.OK, result.order);
    },
  };
}
