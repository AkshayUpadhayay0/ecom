import type { Database } from '../../db/database.js';
import type { ReservationsRepository } from './reservations.repository.js';

/**
 * Gives back every held unit of an order (stock_reserved -, ledger 'reservation_release',
 * reservation -> released). The caller must already hold the order row lock. Variants are
 * touched in id order, the same order checkout reserves in, so this never deadlocks with it.
 * Returns how many reservation rows were released (0 when already released: safe to repeat).
 */
export async function releaseOrderHolds(
  trx: Database,
  reservations: ReservationsRepository,
  orderId: string,
  note: string,
): Promise<number> {
  const held = await reservations.heldForOrder(trx, orderId);
  const sorted = [...held].sort((a, b) => a.variantId.localeCompare(b.variantId));
  for (const hold of sorted) {
    await reservations.release(trx, hold.variantId, hold.quantity);
    await reservations.logMovement(trx, {
      variantId: hold.variantId,
      type: 'reservation_release',
      quantity: hold.quantity,
      orderId,
      note,
    });
  }
  await reservations.markReleased(
    trx,
    sorted.map((hold) => hold.id),
  );
  return sorted.length;
}
