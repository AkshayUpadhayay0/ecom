import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { CartRepository } from '../cart/cart.repository.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import type { OrderConfirmationPayload } from '../notifications/email-templates.js';
import type { OrderItemRow, OrderRow, OrdersRepository } from './orders.repository.js';

const BEING_PREPARED = 'being_prepared';
const PAID = 'paid';

/*
 * Turning a paid order into a fulfilment, shared by payment confirmation (Phase 6) and the admin
 * payment review FULFIL action (Phase 7a), so stock is always sold the same way.
 */

function byVariantId(a: { variantId: string }, b: { variantId: string }): number {
  return a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0;
}

/**
 * Sells the order's items: held units are committed; units without a hold (late payment, or a
 * hold released for review) are taken from available stock with ONE conditional UPDATE each.
 * All or nothing (savepoint): false = not enough stock and nothing changed. Variants are touched
 * in id order, like checkout and the expiry job.
 */
export async function sellOrderStock(
  trx: Database,
  reservations: ReservationsRepository,
  order: OrderRow,
  items: readonly OrderItemRow[],
  note: string,
): Promise<boolean> {
  const held = new Map(
    (await reservations.heldForOrder(trx, order.id)).map((h) => [h.variantId, h]),
  );
  await sql`SAVEPOINT sell_order_stock`.execute(trx);
  for (const item of [...items].sort(byVariantId)) {
    const hold = held.get(item.variantId);
    if (hold?.quantity === item.quantity) {
      if (!(await reservations.commitHeld(trx, item.variantId, item.quantity))) {
        await sql`ROLLBACK TO SAVEPOINT sell_order_stock`.execute(trx);
        return false;
      }
      await reservations.logMovement(trx, {
        variantId: item.variantId,
        type: 'reservation_release',
        quantity: item.quantity,
        orderId: order.id,
        note: `sold (${note})`,
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
        await sql`ROLLBACK TO SAVEPOINT sell_order_stock`.execute(trx);
        return false;
      }
    }
    await reservations.logMovement(trx, {
      variantId: item.variantId,
      type: 'sale',
      quantity: item.quantity,
      orderId: order.id,
      note,
    });
  }
  await reservations.markCommittedForOrder(trx, order.id);
  await sql`RELEASE SAVEPOINT sell_order_stock`.execute(trx);
  return true;
}

export function orderConfirmationPayload(
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

export interface FulfilmentDeps {
  orders: OrdersRepository;
  carts: CartRepository;
  outbox: EmailOutboxRepository;
}

/**
 * After the stock was sold: order -> paid + being_prepared (a revived cancelled order loses its
 * cancellation), history row, purchased quantities out of the customer's cart (`cartId` must be
 * locked by the caller BEFORE the order), one confirmation email (unique per order).
 */
export async function completeFulfilment(
  trx: Database,
  deps: FulfilmentDeps,
  input: {
    order: OrderRow;
    items: readonly OrderItemRow[];
    cartId: string | undefined;
    note: string;
    adminId?: string;
  },
): Promise<void> {
  const { order, items } = input;
  await deps.orders.applyPaymentOutcome(trx, order.id, {
    orderStatus: BEING_PREPARED,
    paymentStatus: PAID,
    markPaid: order.paidAt === null,
    clearCancellation: order.orderStatus === 'cancelled',
    clearReservation: true,
  });
  await deps.orders.logStatus(
    trx,
    order.id,
    order.orderStatus,
    BEING_PREPARED,
    input.note,
    input.adminId,
  );
  if (input.cartId !== undefined) {
    await deps.carts.removePurchased(
      trx,
      input.cartId,
      items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
    );
  }
  await deps.outbox.enqueue(trx, {
    template: 'order_confirmation',
    recipient: order.contactEmail,
    languageCode: order.languageCode,
    orderId: order.id,
    payload: orderConfirmationPayload(order, items),
  });
}
