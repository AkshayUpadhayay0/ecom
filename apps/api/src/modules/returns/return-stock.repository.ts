import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

const RETURN_REFERENCE = 'return_request';
/** Return-owned holds never expire on their own (released on REJECTED / CANCELLED only). */
const NEVER = sql<Date>`'infinity'::timestamptz`;

export interface ReturnHoldRow {
  id: string;
  variantId: string;
  quantity: number;
  status: string;
}

type ReturnMovementType = 'reservation' | 'reservation_release' | 'sale' | 'return';

/**
 * Stock rows owned by a return request: the exchange replacement hold (stock_reservations with
 * return_request_id, no order) and ledger rows referencing the request. Variant counters are
 * changed through ReservationsRepository (the same conditional updates as checkout).
 */
export interface ReturnStockRepository {
  insertHold(
    db: Database,
    input: { returnRequestId: string; variantId: string; quantity: number },
  ): Promise<void>;
  /** The request's holds, locked. */
  holds(db: Database, returnRequestId: string): Promise<ReturnHoldRow[]>;
  setHoldStatus(db: Database, holdId: string, status: 'released' | 'committed'): Promise<void>;
  /** RESELLABLE restock: ONE update adding to on-hand stock. */
  addOnHand(db: Database, variantId: string, quantity: number): Promise<void>;
  /** Positive for 'reservation' and 'return', negative otherwise. The DB guards 'return' rows. */
  logMovement(
    db: Database,
    input: {
      variantId: string;
      type: ReturnMovementType;
      quantity: number;
      returnRequestId: string;
      note: string;
      adminId: string | null;
    },
  ): Promise<void>;
  restockedQuantity(db: Database, returnRequestId: string): Promise<number>;
}

export function createReturnStockRepository(): ReturnStockRepository {
  return {
    async insertHold(db, input) {
      await db
        .insertInto('stock_reservations')
        .values({
          return_request_id: input.returnRequestId,
          variant_id: input.variantId,
          quantity: input.quantity,
          status: 'held',
          expires_at: NEVER,
        })
        .execute();
    },

    async holds(db, returnRequestId) {
      return db
        .selectFrom('stock_reservations')
        .select(['id', 'variant_id as variantId', 'quantity', 'status'])
        .where('return_request_id', '=', returnRequestId)
        .orderBy('created_at')
        .forUpdate()
        .execute();
    },

    async setHoldStatus(db, holdId, status) {
      await db.updateTable('stock_reservations').set({ status }).where('id', '=', holdId).execute();
    },

    async addOnHand(db, variantId, quantity) {
      await db
        .updateTable('product_variants')
        .set((eb) => ({ stock_on_hand: eb('stock_on_hand', '+', quantity) }))
        .where('id', '=', variantId)
        .execute();
    },

    async logMovement(db, input) {
      const positive = input.type === 'reservation' || input.type === 'return';
      await db
        .insertInto('stock_movements')
        .values({
          variant_id: input.variantId,
          movement_type: input.type,
          quantity_delta: positive ? input.quantity : -input.quantity,
          reference_type: RETURN_REFERENCE,
          reference_id: input.returnRequestId,
          note: input.note,
          admin_id: input.adminId,
        })
        .execute();
    },

    async restockedQuantity(db, returnRequestId) {
      const row = await db
        .selectFrom('stock_movements')
        .select(sql<number>`coalesce(sum(quantity_delta), 0)::int`.as('n'))
        .where('movement_type', '=', 'return')
        .where('reference_type', '=', RETURN_REFERENCE)
        .where('reference_id', '=', returnRequestId)
        .executeTakeFirstOrThrow();
      return row.n;
    },
  };
}
