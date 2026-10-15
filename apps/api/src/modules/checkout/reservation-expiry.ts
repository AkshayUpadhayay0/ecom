import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { releaseOrderHolds } from '../inventory/order-holds.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { OrdersRepository } from '../orders/orders.repository.js';
import { CANCEL_REASONS } from './checkout.service.js';

const PENDING_PAYMENT = 'pending_payment';
const CANCELLED = 'cancelled';

export interface ReservationExpiryDeps {
  db: Database;
  orders: OrdersRepository;
  reservations: ReservationsRepository;
  logger: Logger;
}

/**
 * Releases stock held by unpaid orders whose hold has expired and cancels those orders
 * (cancel_reason 'reservation_expired'). Orders are claimed with FOR UPDATE SKIP LOCKED, so
 * several workers (or two runs at once) never process the same order; a second run finds
 * nothing left. Returns how many orders were expired.
 */
export async function releaseExpiredReservations(
  deps: ReservationExpiryDeps,
  batchSize: number,
): Promise<number> {
  const { db, orders, reservations, logger } = deps;
  const expired = await db.transaction().execute(async (trx) => {
    const ids = await reservations.claimExpiredOrders(trx, batchSize);
    for (const orderId of ids) {
      await releaseOrderHolds(trx, reservations, orderId, CANCEL_REASONS.EXPIRED);
      if (await orders.cancelPending(trx, orderId, CANCEL_REASONS.EXPIRED)) {
        await orders.logStatus(trx, orderId, PENDING_PAYMENT, CANCELLED, CANCEL_REASONS.EXPIRED);
      }
    }
    return ids;
  });
  if (expired.length > 0)
    logger.info({ count: expired.length }, 'reservation expiry: orders released');
  return expired.length;
}
