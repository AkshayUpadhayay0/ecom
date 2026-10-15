import { sql } from 'kysely';
import type { PaymentStatus } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';

export interface PaymentRow {
  id: string;
  orderId: string;
  provider: string;
  reference: string;
  amountMinor: string;
  currency: string;
  status: PaymentStatus;
  failureReason: string | null;
  channel: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface PaymentResult {
  status: PaymentStatus;
  failureReason: string | null;
  transactionId: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: Date | null;
  /** Minimal, sanitised provider answer (no card / customer data). */
  verifyPayload: Record<string, unknown>;
}

const COLUMNS = [
  'p.id',
  'p.order_id as orderId',
  'p.provider',
  'p.reference',
  'p.amount_minor as amountMinor',
  'p.currency',
  'p.status',
  'p.failure_reason as failureReason',
  'p.channel',
  'p.created_at as createdAt',
  'p.paid_at as paidAt',
] as const;

const UNRESOLVED = ['initiated', 'pending'];

/** Payment attempts (many per order; at most one 'success': uq_one_success_per_order). */
export interface PaymentsRepository {
  insert(
    db: Database,
    input: {
      orderId: string;
      provider: string;
      reference: string;
      amountMinor: number;
      currency: string;
    },
  ): Promise<PaymentRow>;
  findByReference(db: Database, reference: string, lock?: boolean): Promise<PaymentRow | undefined>;
  /** Own payments only (joined through the order). */
  findOwnedByReference(
    db: Database,
    reference: string,
    customerId: string,
  ): Promise<PaymentRow | undefined>;
  /** Latest attempt per order (for order views). */
  latestForOrders(db: Database, orderIds: readonly string[]): Promise<Map<string, PaymentRow>>;
  markResult(db: Database, id: string, result: PaymentResult): Promise<void>;
  /**
   * Leases up to `limit` unresolved attempts older than `afterMinutes` that were not checked in the
   * last `afterMinutes` (FOR UPDATE SKIP LOCKED + last_checked_at = now(), committed at once), so
   * parallel workers never check the same attempt. Returns references.
   */
  leaseUnresolved(
    db: Database,
    afterMinutes: number,
    maxAgeHours: number,
    limit: number,
  ): Promise<string[]>;
  /** Unresolved attempts older than `maxAgeHours` -> abandoned. Returns how many. */
  abandonStale(db: Database, maxAgeHours: number): Promise<number>;
  /** Unresolved attempts younger than `minutes` exist for the order (payment may be in flight). */
  hasRecentUnresolved(db: Database, orderId: string, minutes: number): Promise<boolean>;
}

export function createPaymentsRepository(): PaymentsRepository {
  return {
    async insert(db, input) {
      const row = await db
        .insertInto('payments')
        .values({
          order_id: input.orderId,
          provider: input.provider,
          reference: input.reference,
          amount_minor: input.amountMinor,
          currency: input.currency,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const created = await this.findByReference(db, input.reference);
      if (created?.id !== row.id) throw new Error('Inserted payment not found');
      return created;
    },

    async findByReference(db, reference, lock = false) {
      let query = db
        .selectFrom('payments as p')
        .select(COLUMNS)
        .where('p.reference', '=', reference);
      if (lock) query = query.forUpdate();
      return (await query.executeTakeFirst()) as PaymentRow | undefined;
    },

    async findOwnedByReference(db, reference, customerId) {
      return (await db
        .selectFrom('payments as p')
        .innerJoin('orders as o', 'o.id', 'p.order_id')
        .select(COLUMNS)
        .where('p.reference', '=', reference)
        .where('o.customer_id', '=', customerId)
        .executeTakeFirst()) as PaymentRow | undefined;
    },

    async latestForOrders(db, orderIds) {
      const result = new Map<string, PaymentRow>();
      if (orderIds.length === 0) return result;
      const rows = (await db
        .selectFrom('payments as p')
        .select(COLUMNS)
        .distinctOn('p.order_id')
        .where('p.order_id', 'in', [...orderIds])
        .orderBy('p.order_id')
        .orderBy('p.created_at', 'desc')
        .orderBy('p.id', 'desc')
        .execute()) as PaymentRow[];
      for (const row of rows) result.set(row.orderId, row);
      return result;
    },

    async markResult(db, id, result) {
      await db
        .updateTable('payments')
        .set({
          status: result.status,
          failure_reason: result.failureReason,
          provider_transaction_id: result.transactionId,
          channel: result.channel,
          gateway_response: result.gatewayResponse,
          paid_at: result.paidAt,
          verified_at: sql`now()`,
          raw_verify_payload: JSON.stringify(result.verifyPayload),
        })
        .where('id', '=', id)
        .execute();
    },

    async leaseUnresolved(db, afterMinutes, maxAgeHours, limit) {
      const result = await sql<{ reference: string }>`
        UPDATE payments SET last_checked_at = now()
        WHERE id IN (
          SELECT id FROM payments
          WHERE status = ANY(${UNRESOLVED}::text[])
            AND created_at < now() - make_interval(mins => ${afterMinutes})
            AND created_at >= now() - make_interval(hours => ${maxAgeHours})
            AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(mins => ${afterMinutes}))
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
        RETURNING reference`.execute(db);
      return result.rows.map((row) => row.reference);
    },

    async abandonStale(db, maxAgeHours) {
      const result = await sql`
        UPDATE payments SET status = 'abandoned', failure_reason = 'ABANDONED'
        WHERE status = ANY(${UNRESOLVED}::text[])
          AND created_at < now() - make_interval(hours => ${maxAgeHours})`.execute(db);
      return Number(result.numAffectedRows ?? 0);
    },

    async hasRecentUnresolved(db, orderId, minutes) {
      const row = await db
        .selectFrom('payments')
        .select('id')
        .where('order_id', '=', orderId)
        .where('status', 'in', UNRESOLVED)
        .where('created_at', '>=', sql<Date>`now() - make_interval(mins => ${minutes})`)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
