import { sql } from 'kysely';
import type { PaymentStatus } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { CartRepository } from '../cart/cart.repository.js';
import { releaseOrderHolds } from '../inventory/order-holds.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import type { OrderConfirmationPayload } from '../notifications/email-templates.js';
import type { OrderItemRow, OrderRow, OrdersRepository } from '../orders/orders.repository.js';
import type { PaymentProvider, ProviderTransaction } from './provider/payment-provider.js';
import type { PaymentResult, PaymentRow, PaymentsRepository } from './payments.repository.js';

const ORDER = {
  PENDING_PAYMENT: 'pending_payment',
  CANCELLED: 'cancelled',
  BEING_PREPARED: 'being_prepared',
  PAYMENT_REVIEW: 'payment_review',
} as const;
const PAID = 'paid';
/** Payment states that never change again here (refunds are a later, admin-side flow). */
const FINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ['success', 'needs_review', 'refunded'];

export const FAILURE_REASONS = {
  DECLINED: 'DECLINED',
  ABANDONED: 'ABANDONED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  ORDER_MISMATCH: 'ORDER_MISMATCH',
  DUPLICATE_SUCCESS: 'DUPLICATE_SUCCESS',
} as const;

export type ConfirmationSource = 'webhook' | 'verify' | 'reconcile';

/** What happened (for logs, tests and the verify response). */
export type ConfirmationOutcome =
  | 'already_final' // nothing changed (repeat delivery)
  | 'pending' // provider has no final answer yet
  | 'paid' // order paid and fulfilled
  | 'paid_needs_attention' // money received, stock gone: payment_review, no auto-refund
  | 'failed' // declined / abandoned: order stays open, cart intact
  | 'needs_review'; // money may be taken but did not match: not paid, flagged

export interface ConfirmationResult {
  outcome: ConfirmationOutcome;
  payment: PaymentRow;
  order: OrderRow;
}

export interface PaymentConfirmationService {
  /**
   * THE single confirmation routine (webhook, verify endpoint, reconciliation job). Asks the
   * provider first (outside any transaction), then applies the result in ONE transaction with
   * the cart, order and payment rows locked (same lock order as checkout and the expiry job:
   * cart -> order -> payment -> reservations -> variants). Idempotent: a repeat finds the
   * payment final and changes nothing. Returns undefined for an unknown reference.
   */
  confirm(reference: string, source: ConfirmationSource): Promise<ConfirmationResult | undefined>;
}

export interface PaymentConfirmationDeps {
  db: Database;
  logger: Logger;
  provider: PaymentProvider;
  payments: PaymentsRepository;
  orders: OrdersRepository;
  carts: CartRepository;
  reservations: ReservationsRepository;
  outbox: EmailOutboxRepository;
}

/** Only what support needs; never card, customer or authorization data. */
function sanitisedPayload(tx: ProviderTransaction): Record<string, unknown> {
  return {
    reference: tx.reference,
    status: tx.status,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    transactionId: tx.transactionId,
    channel: tx.channel,
    gatewayResponse: tx.gatewayResponse,
    paidAt: tx.paidAt?.toISOString() ?? null,
    metadataOrderId: tx.metadataOrderId,
  };
}

function resultOf(
  tx: ProviderTransaction,
  status: PaymentStatus,
  failureReason: string | null,
): PaymentResult {
  return {
    status,
    failureReason,
    transactionId: tx.transactionId,
    channel: tx.channel,
    gatewayResponse: tx.gatewayResponse,
    paidAt: status === 'success' ? (tx.paidAt ?? new Date()) : null,
    verifyPayload: sanitisedPayload(tx),
  };
}

/** Why a provider "success" cannot be applied to this order, or null when it matches. */
function mismatchOf(tx: ProviderTransaction, payment: PaymentRow, order: OrderRow): string | null {
  if (tx.reference !== payment.reference) return FAILURE_REASONS.ORDER_MISMATCH;
  if (tx.metadataOrderId !== null && tx.metadataOrderId !== order.id)
    return FAILURE_REASONS.ORDER_MISMATCH;
  const expected = int8ToNumber(order.totalMinor);
  if (tx.amountMinor !== expected || int8ToNumber(payment.amountMinor) !== expected) {
    return FAILURE_REASONS.AMOUNT_MISMATCH;
  }
  if (tx.currency !== order.currency.trim() || tx.currency !== payment.currency.trim()) {
    return FAILURE_REASONS.CURRENCY_MISMATCH;
  }
  return null;
}

function confirmationEmail(
  order: OrderRow,
  items: readonly OrderItemRow[],
): OrderConfirmationPayload {
  return {
    orderNumber: order.orderNumber,
    currency: order.currency.trim(),
    recipientName: order.recipientName,
    items: items.map((item) => ({
      productName: item.productName,
      sizeLabel: item.sizeLabel,
      quantity: item.quantity,
      unitPriceMinor: int8ToNumber(item.unitPriceMinor),
      lineTotalMinor: int8ToNumber(item.lineTotalMinor),
    })),
    subtotalMinor: int8ToNumber(order.subtotalMinor),
    deliveryFeeMinor: int8ToNumber(order.deliveryFeeMinor),
    totalMinor: int8ToNumber(order.totalMinor),
    delivery: {
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      city: order.city,
      state: order.state,
      landmark: order.landmark,
      zoneName: order.deliveryZoneName,
    },
  };
}

export function createPaymentConfirmationService(
  deps: PaymentConfirmationDeps,
): PaymentConfirmationService {
  const { db, logger, provider, payments, orders, carts, reservations, outbox } = deps;

  /**
   * Sells the order's items: held units are committed; units without a hold (late payment after
   * expiry / cancellation) are taken from available stock. All or nothing (savepoint).
   */
  async function fulfil(
    trx: Database,
    order: OrderRow,
    items: readonly OrderItemRow[],
  ): Promise<boolean> {
    const held = new Map(
      (await reservations.heldForOrder(trx, order.id)).map((h) => [h.variantId, h]),
    );
    const sorted = [...items].sort((a, b) =>
      a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
    );
    await sql`SAVEPOINT fulfil_order`.execute(trx);
    for (const item of sorted) {
      const hold = held.get(item.variantId);
      if (hold?.quantity === item.quantity) {
        if (!(await reservations.commitHeld(trx, item.variantId, item.quantity))) {
          await sql`ROLLBACK TO SAVEPOINT fulfil_order`.execute(trx);
          return false;
        }
        await reservations.logMovement(trx, {
          variantId: item.variantId,
          type: 'reservation_release',
          quantity: item.quantity,
          orderId: order.id,
          note: 'sold (payment confirmed)',
        });
      } else {
        if (hold) {
          // Defensive: a hold that does not match the line is given back first.
          await reservations.release(trx, hold.variantId, hold.quantity);
          await reservations.logMovement(trx, {
            variantId: hold.variantId,
            type: 'reservation_release',
            quantity: hold.quantity,
            orderId: order.id,
            note: 'hold did not match the order line',
          });
        }
        if (!(await reservations.deductAvailable(trx, item.variantId, item.quantity))) {
          await sql`ROLLBACK TO SAVEPOINT fulfil_order`.execute(trx);
          return false;
        }
      }
      await reservations.logMovement(trx, {
        variantId: item.variantId,
        type: 'sale',
        quantity: item.quantity,
        orderId: order.id,
        note: 'payment confirmed',
      });
    }
    await reservations.markCommittedForOrder(trx, order.id);
    await sql`RELEASE SAVEPOINT fulfil_order`.execute(trx);
    return true;
  }

  async function applySuccess(
    trx: Database,
    order: OrderRow,
    payment: PaymentRow,
    tx: ProviderTransaction,
    cartId: string | undefined,
    source: ConfirmationSource,
  ): Promise<ConfirmationOutcome> {
    await payments.markResult(trx, payment.id, resultOf(tx, 'success', null));
    const items = await orders.items(trx, [order.id]);
    const late = order.orderStatus === ORDER.CANCELLED;
    const fulfillable = order.orderStatus === ORDER.PENDING_PAYMENT || late;
    if (fulfillable && (await fulfil(trx, order, items))) {
      await orders.applyPaymentOutcome(trx, order.id, {
        orderStatus: ORDER.BEING_PREPARED,
        paymentStatus: PAID,
        markPaid: true,
        clearCancellation: late,
        clearReservation: true,
      });
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        ORDER.BEING_PREPARED,
        `payment confirmed (${source}${late ? ', late payment re-reserved' : ''})`,
      );
      if (cartId !== undefined) {
        await carts.removePurchased(
          trx,
          cartId,
          items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        );
      }
      await outbox.enqueue(trx, {
        template: 'order_confirmation',
        recipient: order.contactEmail,
        languageCode: order.languageCode,
        orderId: order.id,
        payload: confirmationEmail(order, items),
      });
      return 'paid';
    }
    // Money received but the order cannot be fulfilled: keep the payment, flag the order.
    // Nothing is released or refunded automatically (refund policy: Pending Client Decision).
    await orders.applyPaymentOutcome(trx, order.id, {
      orderStatus: ORDER.PAYMENT_REVIEW,
      paymentStatus: PAID,
      markPaid: true,
    });
    if (order.orderStatus !== ORDER.PAYMENT_REVIEW) {
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        ORDER.PAYMENT_REVIEW,
        'payment received, stock unavailable: needs attention',
      );
    }
    logger.warn(
      { orderId: order.id, orderNumber: order.orderNumber, reference: payment.reference },
      'payment received but order cannot be fulfilled: needs attention',
    );
    return 'paid_needs_attention';
  }

  async function applyMismatch(
    trx: Database,
    order: OrderRow,
    payment: PaymentRow,
    tx: ProviderTransaction,
    reason: string,
  ): Promise<ConfirmationOutcome> {
    await payments.markResult(trx, payment.id, resultOf(tx, 'needs_review', reason));
    if (order.orderStatus === ORDER.PENDING_PAYMENT || order.orderStatus === ORDER.CANCELLED) {
      // Not paid: give the stock back (ledger rows + history note, never silent).
      const released = await releaseOrderHolds(
        trx,
        reservations,
        order.id,
        `payment review: ${reason}`,
      );
      await orders.applyPaymentOutcome(trx, order.id, {
        orderStatus: ORDER.PAYMENT_REVIEW,
        clearReservation: true,
      });
      await orders.logStatus(
        trx,
        order.id,
        order.orderStatus,
        ORDER.PAYMENT_REVIEW,
        `payment ${reason.toLowerCase()} (${released} hold(s) released): needs attention`,
      );
    }
    logger.warn(
      { orderId: order.id, reference: payment.reference, reason },
      'payment did not match the order: needs review',
    );
    return 'needs_review';
  }

  async function applyFailure(
    trx: Database,
    order: OrderRow,
    payment: PaymentRow,
    tx: ProviderTransaction,
  ): Promise<ConfirmationOutcome> {
    const status = tx.status === 'abandoned' ? 'abandoned' : 'failed';
    const reason = status === 'abandoned' ? FAILURE_REASONS.ABANDONED : FAILURE_REASONS.DECLINED;
    await payments.markResult(trx, payment.id, resultOf(tx, status, reason));
    // The order stays open (cart and hold kept until expiry); the customer can retry.
    if (order.paymentStatus !== PAID && order.orderStatus === ORDER.PENDING_PAYMENT) {
      await orders.applyPaymentOutcome(trx, order.id, { paymentStatus: 'failed' });
    }
    return 'failed';
  }

  async function snapshot(
    executor: Database,
    reference: string,
  ): Promise<{ payment: PaymentRow; order: OrderRow } | undefined> {
    const payment = await payments.findByReference(executor, reference);
    if (!payment) return undefined;
    const order = await orders.findById(executor, payment.orderId);
    if (!order) return undefined;
    return { payment, order };
  }

  return {
    async confirm(reference, source) {
      const before = await snapshot(db, reference);
      if (!before) return undefined;
      if (FINAL_PAYMENT_STATUSES.includes(before.payment.status))
        return { outcome: 'already_final', ...before };

      // Network call outside the transaction (no locks held while waiting for the provider).
      const tx = await provider.verify(reference);
      if (tx === null || tx.status === 'pending') return { outcome: 'pending', ...before };

      const outcome = await db.transaction().execute(async (trx) => {
        const cartId = await carts.findActiveCartId(trx, before.order.customerId, true);
        const order = await orders.lockById(trx, before.order.id);
        const payment = await payments.findByReference(trx, reference, true);
        if (!order || !payment) throw new Error('Payment or order disappeared');
        if (FINAL_PAYMENT_STATUSES.includes(payment.status)) return 'already_final' as const;

        if (tx.status !== 'success') return applyFailure(trx, order, payment, tx);
        if (order.paymentStatus === PAID) {
          // Another attempt already paid this order (e.g. two tabs): money taken twice.
          await payments.markResult(
            trx,
            payment.id,
            resultOf(tx, 'needs_review', FAILURE_REASONS.DUPLICATE_SUCCESS),
          );
          logger.warn(
            { orderId: order.id, reference },
            'second successful payment for a paid order: needs review (no auto-refund)',
          );
          return 'needs_review' as const;
        }
        const mismatch = mismatchOf(tx, payment, order);
        if (mismatch !== null) return applyMismatch(trx, order, payment, tx, mismatch);
        return applySuccess(trx, order, payment, tx, cartId, source);
      });

      const after = await snapshot(db, reference);
      if (!after) throw new Error('Payment or order disappeared');
      if (outcome !== 'already_final') {
        logger.info(
          { reference, orderId: after.order.id, outcome, source },
          'payment confirmation applied',
        );
      }
      return { outcome, ...after };
    },
  };
}
