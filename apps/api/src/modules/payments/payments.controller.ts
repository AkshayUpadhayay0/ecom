import type { RequestHandler } from 'express';
import {
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
  initializePaymentSchema,
  verifyPaymentQuerySchema,
} from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { bodyOf, sendData } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { PaymentsService } from './payments.service.js';

export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';

export interface PaymentsController {
  initialize: RequestHandler;
  verify: RequestHandler;
  webhook: RequestHandler;
}

/** Optional on initialize: a repeat with the same key returns the same attempt. */
function optionalIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const result = idempotencyKeySchema.safeParse(header);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Request validation failed.', {
      issues: [{ path: IDEMPOTENCY_HEADER, message: 'must be 8-128 letters, digits or - _ . :' }],
    });
  }
  return result.data;
}

export function createPaymentsController(service: PaymentsService): PaymentsController {
  return {
    initialize: async (req, res) => {
      // .strict(): any amount / status / "paid" field in the body is rejected, never used.
      const { orderId } = initializePaymentSchema.parse(bodyOf(req));
      const key = optionalIdempotencyKey(req.get(IDEMPOTENCY_HEADER));
      res.set('Cache-Control', 'no-store');
      sendData(
        res,
        HTTP_STATUS.CREATED,
        await service.initialize(getCustomer(req).id, orderId, key),
      );
    },
    verify: async (req, res) => {
      const { reference } = verifyPaymentQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.verify(getCustomer(req).id, reference));
    },
    webhook: async (req, res) => {
      // express.raw() put the untouched bytes here (needed for the HMAC).
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await service.handleWebhook(
        rawBody,
        req.get(PAYSTACK_SIGNATURE_HEADER),
        req.ip,
      );
      res.status(HTTP_STATUS.OK).json({ data: { received: true, duplicate: result.duplicate } });
    },
  };
}
