import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface HeldReservation {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
}

const RESERVATION = 'reservation';
/** Ledger types written here: reserved units (+/-) and sales (on-hand -). */
type MovementType = 'reservation' | 'reservation_release' | 'sale';
const ORDER_REFERENCE = 'order';
/** Unpaid orders whose holds may expire (a payment in flight is left to Phase 6 verification). */
const EXPIRABLE_PAYMENT_STATUSES = ['unpaid', 'failed'];

/**
 * Stock holds for checkout. Reserving is ONE conditional UPDATE (never read-then-write), so
 * concurrent buyers can never hold more than stock_on_hand - stock_reserved.
 * Ledger: 'reservation' / 'reservation_release' movements record RESERVED units (+/-); on-hand
 * stock is the sum of the other movement types.
 */
export interface ReservationsRepository {
  /** true when `quantity` units were reserved; false = not enough available (nothing changed). */
  reserve(db: Database, variantId: string, quantity: number): Promise<boolean>;
  /** Gives held units back (never below zero). */
  release(db: Database, variantId: string, quantity: number): Promise<void>;
  insertHeld(
    db: Database,
    orderId: string,
    lines: readonly { variantId: string; quantity: number }[],
    expiresAt: Date,
  ): Promise<void>;
  heldForOrder(db: Database, orderId: string): Promise<HeldReservation[]>;
  extend(db: Database, orderId: string, expiresAt: Date): Promise<void>;
  markReleased(db: Database, ids: readonly string[]): Promise<void>;
  /**
   * Turns held units into a sale: on-hand AND reserved both drop by `quantity` (one conditional
   * UPDATE). false = the hold is not there any more (nothing changed).
   */
  commitHeld(db: Database, variantId: string, quantity: number): Promise<boolean>;
  /** Sells units that are not held (late payment): ONE conditional UPDATE on available stock. */
  deductAvailable(db: Database, variantId: string, quantity: number): Promise<boolean>;
  /** The order's holds are fulfilled (held / released rows -> committed). */
  markCommittedForOrder(db: Database, orderId: string): Promise<void>;
  /**
   * Locks up to `limit` unpaid pending orders whose hold has expired (FOR UPDATE SKIP LOCKED, so
   * parallel sweeps never take the same order). Orders are locked BEFORE their reservations, the
   * same order checkout uses, so the two can never deadlock.
   */
  claimExpiredOrders(db: Database, limit: number, inFlightGraceMinutes: number): Promise<string[]>;
  logMovement(
    db: Database,
    input: {
      variantId: string;
      type: MovementType;
      quantity: number;
      orderId: string;
      note: string;
    },
  ): Promise<void>;
}

export function createReservationsRepository(): ReservationsRepository {
  return {
    async reserve(db, variantId, quantity) {
      const result = await db
        .updateTable('product_variants')
        .set((eb) => ({ stock_reserved: eb('stock_reserved', '+', quantity) }))
        .where('id', '=', variantId)
        .where('is_active', '=', true)
        .where(sql<number>`stock_on_hand - stock_reserved`, '>=', quantity)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },

    async release(db, variantId, quantity) {
      await db
        .updateTable('product_variants')
        .set((eb) => ({ stock_reserved: eb('stock_reserved', '-', quantity) }))
        .where('id', '=', variantId)
        .where('stock_reserved', '>=', quantity)
        .execute();
    },

    async insertHeld(db, orderId, lines, expiresAt) {
      if (lines.length === 0) return;
      await db
        .insertInto('stock_reservations')
        .values(
          lines.map((line) => ({
            order_id: orderId,
            variant_id: line.variantId,
            quantity: line.quantity,
            status: 'held',
            expires_at: expiresAt,
          })),
        )
        .execute();
    },

    async heldForOrder(db, orderId) {
      const rows = await db
        .selectFrom('stock_reservations')
        .select(['id', 'order_id as orderId', 'variant_id as variantId', 'quantity'])
        .where('order_id', '=', orderId)
        .where('status', '=', 'held')
        .forUpdate()
        .execute();
      return rows.map((row) => ({ ...row, orderId: row.orderId ?? orderId }));
    },

    async extend(db, orderId, expiresAt) {
      await db
        .updateTable('stock_reservations')
        .set({ expires_at: expiresAt })
        .where('order_id', '=', orderId)
        .where('status', '=', 'held')
        .execute();
    },

    async markReleased(db, ids) {
      if (ids.length === 0) return;
      await db
        .updateTable('stock_reservations')
        .set({ status: 'released' })
        .where('id', 'in', [...ids])
        .execute();
    },

    async commitHeld(db, variantId, quantity) {
      const result = await db
        .updateTable('product_variants')
        .set((eb) => ({
          stock_on_hand: eb('stock_on_hand', '-', quantity),
          stock_reserved: eb('stock_reserved', '-', quantity),
        }))
        .where('id', '=', variantId)
        .where('stock_reserved', '>=', quantity)
        .where('stock_on_hand', '>=', quantity)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },

    async deductAvailable(db, variantId, quantity) {
      const result = await db
        .updateTable('product_variants')
        .set((eb) => ({ stock_on_hand: eb('stock_on_hand', '-', quantity) }))
        .where('id', '=', variantId)
        .where(sql<number>`stock_on_hand - stock_reserved`, '>=', quantity)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },

    async markCommittedForOrder(db, orderId) {
      await db
        .updateTable('stock_reservations')
        .set({ status: 'committed' })
        .where('order_id', '=', orderId)
        .where('status', 'in', ['held', 'released'])
        .execute();
    },

    async claimExpiredOrders(db, limit, inFlightGraceMinutes) {
      // An order whose payment attempt started in the last few minutes may be being paid right
      // now: it keeps its hold until that attempt is resolved or older than the grace period.
      const result = await sql<{ id: string }>`
        SELECT o.id FROM orders o
        WHERE o.order_status = 'pending_payment'
          AND o.payment_status = ANY(${EXPIRABLE_PAYMENT_STATUSES}::text[])
          AND o.reservation_expires_at < now()
          AND NOT EXISTS (
            SELECT 1 FROM payments p
            WHERE p.order_id = o.id AND p.status IN ('initiated', 'pending')
              AND p.created_at >= now() - make_interval(mins => ${inFlightGraceMinutes}))
        ORDER BY o.reservation_expires_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`.execute(db);
      return result.rows.map((row) => row.id);
    },

    async logMovement(db, input) {
      await db
        .insertInto('stock_movements')
        .values({
          variant_id: input.variantId,
          movement_type: input.type,
          // A reservation adds reserved units; a release or a sale takes units away.
          quantity_delta: input.type === RESERVATION ? input.quantity : -input.quantity,
          reference_type: ORDER_REFERENCE,
          reference_id: input.orderId,
          note: input.note,
        })
        .execute();
    },
  };
}
