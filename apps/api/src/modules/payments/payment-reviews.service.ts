import type { PaymentReviewDto, ResolvePaymentReviewRequest } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import type { AuditActor } from '../audit/audit-actor.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { CartRepository } from '../cart/cart.repository.js';
import { releaseOrderHolds } from '../inventory/order-holds.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import { completeFulfilment, sellOrderStock } from '../orders/order-fulfilment.js';
import type { OrderRow, OrdersRepository } from '../orders/orders.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { receivedOf, toPaymentReviewDto } from './payment-reviews.dto.js';
import type {
  PaymentReviewRow,
  PaymentReviewsRepository,
  ResolutionRow,
} from './payment-reviews.repository.js';

const PAYMENT_REVIEW = 'payment_review';
const CANCELLED = 'cancelled';
const PAID = 'paid';
const REFUNDED_CANCEL_REASON = 'refunded_after_payment_review';

export interface PaymentReviewsService {
  list(query: {
    page: number;
    pageSize?: number | undefined;
    state: 'open' | 'all';
  }): Promise<Page<PaymentReviewDto>>;
  get(paymentId: string): Promise<PaymentReviewDto>;
  /**
   * Admin decision on a payment that needs review. No refund is executed by the system: the
   * refund policy is a Pending Client Decision and the provider refund call is a stub.
   */
  resolve(
    actor: AuditActor,
    paymentId: string,
    input: ResolvePaymentReviewRequest,
  ): Promise<PaymentReviewDto>;
}

export interface PaymentReviewsServiceDeps {
  db: Database;
  logger: Logger;
  reviews: PaymentReviewsRepository;
  orders: OrdersRepository;
  carts: CartRepository;
  reservations: ReservationsRepository;
  outbox: EmailOutboxRepository;
  settings: SettingsService;
}

function alreadyResolved(message = 'This payment review was already resolved.'): AppError {
  return new AppError('REVIEW_ALREADY_RESOLVED', HTTP_STATUS.CONFLICT, message);
}

function notAllowed(message: string): AppError {
  return new AppError('REVIEW_ACTION_NOT_ALLOWED', HTTP_STATUS.CONFLICT, message);
}

export function createPaymentReviewsService(
  deps: PaymentReviewsServiceDeps,
): PaymentReviewsService {
  const { db, logger, reviews, orders, carts, reservations, outbox, settings } = deps;

  async function load(executor: Database, paymentId: string): Promise<PaymentReviewDto> {
    const row = await reviews.find(executor, paymentId);
    if (!row) throw notFoundError('Payment');
    const [resolutions, open] = await Promise.all([
      reviews.resolutions(executor, [paymentId]),
      reviews.isOpen(executor, paymentId),
    ]);
    return toPaymentReviewDto(row, resolutions, open);
  }

  /** FULFIL: only when the order can really be fulfilled with this payment. */
  async function fulfil(
    trx: Database,
    actor: AuditActor,
    review: PaymentReviewRow,
    order: OrderRow,
    resolutions: readonly ResolutionRow[],
    cartId: string | undefined,
    note: string,
  ): Promise<void> {
    if (resolutions.length > 0) throw alreadyResolved();
    if (order.orderStatus !== PAYMENT_REVIEW)
      throw notAllowed('Only orders waiting in payment review can be fulfilled here.');
    const received = receivedOf(review);
    const total = int8ToNumber(order.totalMinor);
    const paidByThis = review.paymentStatus === 'success' && order.paymentStatus === PAID;
    const coveringMismatch =
      review.paymentStatus === 'needs_review' &&
      review.reason === 'AMOUNT_MISMATCH' &&
      order.paymentStatus !== PAID &&
      received.currency === order.currency.trim() &&
      received.amountMinor >= total;
    if (!paidByThis && !coveringMismatch) {
      throw notAllowed(
        'FULFIL needs a late payment (LATE_NO_STOCK) or an amount mismatch where the amount received covers the order total in the same currency. Use a refund action instead.',
      );
    }
    const items = await orders.items(trx, [order.id]);
    if (
      !(await sellOrderStock(trx, reservations, order, items, 'payment review: fulfilled by admin'))
    ) {
      // Throwing rolls back the whole transaction: nothing is half-applied.
      throw new AppError(
        'INSUFFICIENT_STOCK',
        HTTP_STATUS.CONFLICT,
        'Not enough stock to fulfil this order now.',
      );
    }
    if (review.paymentStatus === 'needs_review')
      await reviews.setPaymentStatus(trx, review.paymentId, 'success');
    await completeFulfilment(
      trx,
      { orders, carts, outbox },
      {
        order,
        items,
        cartId,
        note: `payment review resolved: fulfilled (${note})`,
        adminId: actor.adminId,
      },
    );
    await reviews.insertResolution(trx, {
      paymentId: review.paymentId,
      orderId: order.id,
      action: 'FULFIL',
      note,
      adminId: actor.adminId,
    });
    const excess = received.amountMinor - total;
    if (excess > 0) {
      // Overpayment: tracked automatically as a refund owed (decided 16 Oct 2026).
      await reviews.insertResolution(trx, {
        paymentId: review.paymentId,
        orderId: order.id,
        action: 'MARK_REFUND_REQUIRED',
        amountMinor: excess,
        note: `Overpayment recorded automatically on FULFIL: received ${received.amountMinor}, order total ${total}.`,
        adminId: actor.adminId,
      });
    }
  }

  async function markRefundRequired(
    trx: Database,
    actor: AuditActor,
    review: PaymentReviewRow,
    order: OrderRow,
    resolutions: readonly ResolutionRow[],
    input: { amountMinor: number; note: string },
  ): Promise<void> {
    if (resolutions.some((r) => r.action === 'MARK_REFUND_REQUIRED'))
      throw alreadyResolved('A refund is already recorded as owed for this payment.');
    const received = receivedOf(review);
    if (input.amountMinor > received.amountMinor) {
      throw new AppError(
        'VALIDATION_ERROR',
        HTTP_STATUS.BAD_REQUEST,
        'Request validation failed.',
        {
          issues: [
            {
              path: 'amountMinor',
              message: `Cannot exceed the amount received (${received.amountMinor}).`,
            },
          ],
        },
      );
    }
    await reviews.insertResolution(trx, {
      paymentId: review.paymentId,
      orderId: order.id,
      action: 'MARK_REFUND_REQUIRED',
      amountMinor: input.amountMinor,
      note: input.note,
      adminId: actor.adminId,
    });
    // History shows the decision; the order stays out of fulfilment (status unchanged).
    await orders.logStatus(
      trx,
      order.id,
      order.orderStatus,
      order.orderStatus,
      `refund required: ${input.amountMinor} (${input.note})`,
      actor.adminId,
    );
  }

  async function markRefunded(
    trx: Database,
    actor: AuditActor,
    review: PaymentReviewRow,
    order: OrderRow,
    resolutions: readonly ResolutionRow[],
    input: { refundReference: string; note: string },
  ): Promise<void> {
    const fulfilledByThis =
      review.paymentStatus === 'success' && order.orderStatus !== PAYMENT_REVIEW;
    if (fulfilledByThis) {
      // The order was fulfilled with this payment: only a recorded excess can be refunded.
      if (!resolutions.some((r) => r.action === 'MARK_REFUND_REQUIRED')) {
        throw notAllowed(
          'This payment paid a fulfilled order. Record the refund owed first (MARK_REFUND_REQUIRED).',
        );
      }
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        order.orderStatus,
        `partial refund done manually: ${input.refundReference} (${input.note})`,
        actor.adminId,
      );
    } else if (review.reason === 'DUPLICATE_SUCCESS') {
      // The order was paid by another attempt: only this payment is refunded.
      await reviews.setPaymentStatus(trx, review.paymentId, 'refunded');
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        order.orderStatus,
        `duplicate payment refunded manually: ${input.refundReference} (${input.note})`,
        actor.adminId,
      );
    } else {
      if (order.orderStatus !== PAYMENT_REVIEW)
        throw notAllowed('Only orders waiting in payment review can be cancelled by a refund.');
      await reviews.setPaymentStatus(trx, review.paymentId, 'refunded');
      await releaseOrderHolds(trx, reservations, order.id, 'payment refunded after review');
      await orders.applyPaymentOutcome(trx, order.id, {
        orderStatus: CANCELLED,
        ...(order.paymentStatus === PAID && { paymentStatus: 'refunded' }),
        clearReservation: true,
        cancelReason: REFUNDED_CANCEL_REASON,
      });
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        CANCELLED,
        `refunded manually: ${input.refundReference} (${input.note})`,
        actor.adminId,
      );
    }
    await reviews.insertResolution(trx, {
      paymentId: review.paymentId,
      orderId: order.id,
      action: 'MARK_REFUNDED',
      refundReference: input.refundReference,
      note: input.note,
      adminId: actor.adminId,
    });
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await reviews.list(db, query.state, page);
      const resolutions = await reviews.resolutions(
        db,
        rows.map((r) => r.paymentId),
      );
      const items = await Promise.all(
        rows.map(async (row) =>
          toPaymentReviewDto(
            row,
            resolutions.filter((r) => r.paymentId === row.paymentId),
            query.state === 'open' || (await reviews.isOpen(db, row.paymentId)),
          ),
        ),
      );
      return { items, meta: toPageMeta(page, total) };
    },

    get: (paymentId) => load(db, paymentId),

    async resolve(actor, paymentId, input) {
      const before = await reviews.find(db, paymentId);
      if (!before) throw notFoundError('Payment');
      const result = await db.transaction().execute(async (trx) => {
        // Same lock order as checkout / confirmation: cart -> order -> payment.
        const cartId = await carts.findActiveCartId(trx, before.customerId, true);
        const order = await orders.lockById(trx, before.orderId);
        const locked = await reviews.lockPayment(trx, paymentId);
        const review = await reviews.find(trx, paymentId);
        if (!order || !locked || !review) throw notFoundError('Payment');
        if (!(await reviews.isOpen(trx, paymentId))) throw alreadyResolved();
        const resolutions = await reviews.resolutions(trx, [paymentId]);
        if (resolutions.some((r) => r.action === 'MARK_REFUNDED')) throw alreadyResolved();

        switch (input.action) {
          case 'FULFIL':
            await fulfil(trx, actor, review, order, resolutions, cartId, input.note);
            break;
          case 'MARK_REFUND_REQUIRED':
            await markRefundRequired(trx, actor, review, order, resolutions, input);
            break;
          case 'MARK_REFUNDED':
            await markRefunded(trx, actor, review, order, resolutions, input);
            break;
        }
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'payment_review.resolve',
          entityType: 'payment',
          entityId: paymentId,
          before: {
            paymentStatus: review.paymentStatus,
            orderStatus: order.orderStatus,
            reason: review.reason,
          },
          after: {
            action: input.action,
            ...('amountMinor' in input && { amountMinor: input.amountMinor }),
            ...('refundReference' in input && { refundReference: input.refundReference }),
            note: input.note,
          },
          ipAddress: actor.ipAddress,
        });
        return load(trx, paymentId);
      });
      logger.info(
        { paymentId, action: input.action, adminId: actor.adminId },
        'payment review resolved',
      );
      return result;
    },
  };
}
