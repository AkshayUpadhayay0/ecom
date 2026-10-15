import { createHash, randomBytes } from 'node:crypto';
import type { PaymentInitDto, PaymentVerificationDto } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { IdempotencyRepository } from '../checkout/idempotency.repository.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { OrdersRepository } from '../orders/orders.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { PaymentConfirmationService } from './payment-confirmation.service.js';
import { PaymentProviderError, type PaymentProvider } from './provider/payment-provider.js';
import type { PaymentsRepository } from './payments.repository.js';
import type { WebhookEventsRepository } from './webhook-events.repository.js';

const PENDING_PAYMENT = 'pending_payment';
const PAID = 'paid';
const REFERENCE_RANDOM_BYTES = 16;
const MS_PER_MINUTE = 60_000;
const IDEMPOTENCY_SCOPE = 'payment.initialize';
const INITIALIZE_FAILED = 'INITIALIZE_FAILED';
/** Paystack events that move a payment (others are stored and ignored). */
const HANDLED_EVENTS = new Set(['charge.success', 'charge.failed']);

export interface PaymentsServiceDeps {
  db: Database;
  logger: Logger;
  provider: PaymentProvider;
  payments: PaymentsRepository;
  orders: OrdersRepository;
  reservations: ReservationsRepository;
  idempotency: IdempotencyRepository;
  webhookEvents: WebhookEventsRepository;
  confirmation: PaymentConfirmationService;
  settings: SettingsService;
  callbackUrl: string;
}

export interface WebhookResult {
  duplicate: boolean;
}

export interface PaymentsService {
  initialize(
    customerId: string,
    orderId: string,
    idempotencyKey: string | undefined,
  ): Promise<PaymentInitDto>;
  verify(customerId: string, reference: string): Promise<PaymentVerificationDto>;
  /** Signature-checked, stored (or recognised as duplicate), then confirmed via provider verify. */
  handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
    sourceIp: string | undefined,
  ): Promise<WebhookResult>;
}

const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).nullish(),
      reference: z.string().max(200).nullish(),
      status: z.string().max(50).nullish(),
      amount: z.number().nullish(),
      currency: z.string().max(10).nullish(),
      channel: z.string().max(50).nullish(),
      gateway_response: z.string().max(500).nullish(),
      paid_at: z.string().max(50).nullish(),
    })
    .loose()
    .default({}),
});

function providerUnavailable(err: unknown): AppError {
  const message = err instanceof Error ? err.message : 'unknown error';
  return new AppError(
    'PAYMENT_PROVIDER_ERROR',
    HTTP_STATUS.BAD_GATEWAY,
    'The payment provider is not reachable. Try again shortly.',
    {
      reason: message,
    },
  );
}

function newReference(orderNumber: string): string {
  return `${orderNumber}-${randomBytes(REFERENCE_RANDOM_BYTES).toString('hex')}`;
}

export function createPaymentsService(deps: PaymentsServiceDeps): PaymentsService {
  const { db, logger, provider, payments, orders, reservations, settings } = deps;

  /** Locks the order, checks it can be paid now, extends its hold and records a new attempt. */
  async function prepareAttempt(trx: Database, customerId: string, orderId: string) {
    const order = await orders.lockById(trx, orderId);
    if (order?.customerId !== customerId) throw notFoundError('Order');
    if (order.paymentStatus === PAID) {
      throw new AppError('ORDER_ALREADY_PAID', HTTP_STATUS.CONFLICT, 'This order is already paid.');
    }
    if (order.orderStatus !== PENDING_PAYMENT) {
      throw new AppError(
        'ORDER_NOT_PAYABLE',
        HTTP_STATUS.CONFLICT,
        'This order can no longer be paid. Check out again.',
      );
    }
    const now = new Date();
    if (order.reservationExpiresAt === null || order.reservationExpiresAt <= now) {
      throw new AppError(
        'RESERVATION_EXPIRED',
        HTTP_STATUS.CONFLICT,
        'Your items are no longer reserved. Check out again.',
      );
    }
    // A new attempt extends the hold, within the existing cap from placement.
    const [holdMinutes, maxTotalMinutes] = await Promise.all([
      settings.getLimit(trx, 'checkout.reservation_minutes'),
      settings.getSetting(trx, 'checkout.reservation_max_total_minutes'),
    ]);
    const extended = new Date(
      Math.min(
        now.getTime() + holdMinutes * MS_PER_MINUTE,
        order.placedAt.getTime() + maxTotalMinutes * MS_PER_MINUTE,
      ),
    );
    let expiresAt = order.reservationExpiresAt;
    if (extended > expiresAt) {
      await orders.setReservationExpiry(trx, order.id, extended);
      await reservations.extend(trx, order.id, extended);
      expiresAt = extended;
    }
    const payment = await payments.insert(trx, {
      orderId: order.id,
      provider: provider.name,
      reference: newReference(order.orderNumber),
      amountMinor: int8ToNumber(order.totalMinor),
      currency: order.currency.trim(),
    });
    return { order, payment, expiresAt };
  }

  async function startAttempt(customerId: string, orderId: string): Promise<PaymentInitDto> {
    const { order, payment, expiresAt } = await db
      .transaction()
      .execute((trx) => prepareAttempt(trx, customerId, orderId));
    try {
      // Provider call after commit: no locks held while waiting on the network.
      const { authorizationUrl } = await provider.initialize({
        reference: payment.reference,
        email: order.contactEmail,
        amountMinor: int8ToNumber(payment.amountMinor),
        currency: payment.currency.trim(),
        callbackUrl: deps.callbackUrl,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      });
      logger.info(
        { orderId: order.id, reference: payment.reference, provider: provider.name },
        'payment initialized',
      );
      return {
        reference: payment.reference,
        authorizationUrl,
        amountMinor: int8ToNumber(payment.amountMinor),
        currency: payment.currency.trim(),
        reservationExpiresAt: expiresAt.toISOString(),
        mocked: provider.mocked,
      };
    } catch (err) {
      await payments.markResult(db, payment.id, {
        status: 'failed',
        failureReason: INITIALIZE_FAILED,
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        paidAt: null,
        verifyPayload: {},
      });
      logger.error(
        {
          orderId: order.id,
          reference: payment.reference,
          err: err instanceof Error ? err.message : 'error',
        },
        'payment initialize failed',
      );
      throw providerUnavailable(err);
    }
  }

  return {
    async initialize(customerId, orderId, idempotencyKey) {
      if (idempotencyKey === undefined) return startAttempt(customerId, orderId);
      const requestHash = createHash('sha256').update(orderId).digest('hex');
      const claim = await deps.idempotency.claim(db, {
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        subjectId: customerId,
        requestHash,
      });
      if (!claim.created) {
        if (claim.record.requestHash !== requestHash) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REUSED',
            HTTP_STATUS.CONFLICT,
            'This Idempotency-Key was already used for another order.',
          );
        }
        const stored = claim.record.responseBody as PaymentInitDto | null;
        if (stored?.authorizationUrl === undefined) {
          throw new AppError(
            'DUPLICATE_REQUEST',
            HTTP_STATUS.CONFLICT,
            'This payment is still being started. Try again.',
          );
        }
        return stored;
      }
      try {
        const result = await startAttempt(customerId, orderId);
        await deps.idempotency.complete(db, {
          scope: IDEMPOTENCY_SCOPE,
          key: idempotencyKey,
          subjectId: customerId,
          status: HTTP_STATUS.CREATED,
          body: result,
        });
        return result;
      } catch (err) {
        // A failed start may be retried with the same key.
        await deps.idempotency.release(db, {
          scope: IDEMPOTENCY_SCOPE,
          key: idempotencyKey,
          subjectId: customerId,
        });
        throw err;
      }
    },

    async verify(customerId, reference) {
      const owned = await payments.findOwnedByReference(db, reference, customerId);
      if (!owned) throw notFoundError('Payment');
      let result;
      try {
        result = await deps.confirmation.confirm(reference, 'verify');
      } catch (err) {
        if (err instanceof PaymentProviderError) throw providerUnavailable(err);
        throw err;
      }
      if (!result) throw notFoundError('Payment');
      return {
        reference,
        paymentStatus: result.payment.status,
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        orderStatus: result.order.orderStatus,
        orderPaymentStatus: result.order.paymentStatus,
      };
    },

    async handleWebhook(rawBody, signature, sourceIp) {
      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        // Never log the body or the signature value.
        logger.warn(
          { sourceIp, bytes: rawBody.length, hasSignature: signature !== undefined },
          'paystack webhook: invalid signature',
        );
        throw new AppError('INVALID_SIGNATURE', HTTP_STATUS.UNAUTHORIZED, 'Invalid signature.');
      }
      let parsed;
      try {
        parsed = webhookSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
      } catch {
        parsed = undefined;
      }
      if (!parsed?.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Unreadable webhook payload.',
        );
      }
      const { event, data } = parsed.data;
      const reference = data.reference ?? null;
      const eventKey = `${event}:${data.id ?? reference ?? createHash('sha256').update(rawBody).digest('hex')}`;
      // Only non-sensitive fields are kept (no customer, card or authorization data).
      const payload = {
        event,
        data: {
          id: data.id ?? null,
          reference,
          status: data.status ?? null,
          amount: data.amount ?? null,
          currency: data.currency ?? null,
          channel: data.channel ?? null,
          gateway_response: data.gateway_response ?? null,
          paid_at: data.paid_at ?? null,
        },
      };
      // If this throws, the error handler answers 5xx and Paystack retries.
      const stored = await deps.webhookEvents.store(db, {
        eventKey,
        eventType: event,
        reference,
        payload,
      });
      if (stored.outcome === 'duplicate') return { duplicate: true };

      let error: string | null = null;
      if (HANDLED_EVENTS.has(event) && reference !== null) {
        try {
          // Never trust the payload: the routine asks the provider (verify) itself.
          const result = await deps.confirmation.confirm(reference, 'webhook');
          if (!result) error = 'unknown reference';
        } catch (err) {
          // Stored already: answer 200 anyway; the reconciliation job retries the payment.
          error = err instanceof Error ? err.message : 'processing failed';
          logger.error(
            { reference, event, err: error },
            'paystack webhook: processing failed (reconciliation will retry)',
          );
        }
      }
      await deps.webhookEvents.markProcessed(db, stored.id, error);
      return { duplicate: false };
    },
  };
}
