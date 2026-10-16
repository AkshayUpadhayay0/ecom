import { sql, type Expression, type SqlBool } from 'kysely';
import type { PaymentReviewAction } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

/** Reason codes that put a payment in the review queue (payments.failure_reason). */
export const REVIEW_REASONS = [
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'ORDER_MISMATCH',
  'DUPLICATE_SUCCESS',
  'LATE_NO_STOCK',
] as const;

export interface PaymentReviewRow {
  paymentId: string;
  reference: string;
  reason: string | null;
  paymentStatus: string;
  amountMinor: string;
  currency: string;
  /** What the provider reported (sanitised verify summary), when known. */
  receivedAmountMinor: string | null;
  receivedCurrency: string | null;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderPaymentStatus: string;
  orderTotalMinor: string;
  orderCurrency: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  createdAt: Date;
}

export interface ResolutionRow {
  id: string;
  paymentId: string;
  action: PaymentReviewAction;
  amountMinor: string | null;
  refundReference: string | null;
  note: string;
  adminId: string;
  adminName: string;
  createdAt: Date;
}

const hasResolution = (action: PaymentReviewAction) =>
  sql<SqlBool>`EXISTS (SELECT 1 FROM payment_review_resolutions r WHERE r.payment_id = p.id AND r.action = ${action})`;

/**
 * Still needs an admin decision: money taken but not applied (needs_review), paid but not
 * fulfilled (order in payment_review), or a refund recorded as owed and not yet done.
 */
const OPEN = sql<SqlBool>`(NOT ${hasResolution('MARK_REFUNDED')} AND (
  p.status = 'needs_review'
  OR (p.status = 'success' AND o.order_status = 'payment_review')
  OR ${hasResolution('MARK_REFUND_REQUIRED')}))`;

/** Was ever part of the review queue. */
const EVER_IN_REVIEW = sql<SqlBool>`(p.status = 'needs_review' OR p.failure_reason = ANY(${[...REVIEW_REASONS]}::text[])
  OR EXISTS (SELECT 1 FROM payment_review_resolutions r WHERE r.payment_id = p.id))`;

function baseQuery(db: Database) {
  return db
    .selectFrom('payments as p')
    .innerJoin('orders as o', 'o.id', 'p.order_id')
    .innerJoin('customers as c', 'c.id', 'o.customer_id')
    .select([
      'p.id as paymentId',
      'p.reference',
      'p.failure_reason as reason',
      'p.status as paymentStatus',
      'p.amount_minor as amountMinor',
      'p.currency',
      sql<string | null>`p.raw_verify_payload->>'amountMinor'`.as('receivedAmountMinor'),
      sql<string | null>`p.raw_verify_payload->>'currency'`.as('receivedCurrency'),
      'o.id as orderId',
      'o.order_number as orderNumber',
      'o.order_status as orderStatus',
      'o.payment_status as orderPaymentStatus',
      'o.total_minor as orderTotalMinor',
      'o.currency as orderCurrency',
      'c.id as customerId',
      'c.full_name as customerName',
      sql<string>`c.email::text`.as('customerEmail'),
      'p.created_at as createdAt',
    ]);
}

export interface PaymentReviewsRepository {
  list(
    db: Database,
    state: 'open' | 'all',
    page: PageRequest,
  ): Promise<{ rows: PaymentReviewRow[]; total: number }>;
  find(db: Database, paymentId: string): Promise<PaymentReviewRow | undefined>;
  isOpen(db: Database, paymentId: string): Promise<boolean>;
  countOpen(db: Database): Promise<number>;
  resolutions(db: Database, paymentIds: readonly string[]): Promise<ResolutionRow[]>;
  insertResolution(
    db: Database,
    input: {
      paymentId: string;
      orderId: string;
      action: PaymentReviewAction;
      amountMinor?: number;
      refundReference?: string;
      note: string;
      adminId: string;
    },
  ): Promise<void>;
  /** The payment row locked (FOR UPDATE), by id. */
  lockPayment(db: Database, paymentId: string): Promise<{ id: string; status: string } | undefined>;
  setPaymentStatus(db: Database, paymentId: string, status: 'success' | 'refunded'): Promise<void>;
}

export function createPaymentReviewsRepository(): PaymentReviewsRepository {
  return {
    async list(db, state, page) {
      const condition: Expression<SqlBool> = state === 'open' ? OPEN : EVER_IN_REVIEW;
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .where(condition)
          .orderBy('p.created_at', 'desc')
          .orderBy('p.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('payments as p')
          .innerJoin('orders as o', 'o.id', 'p.order_id')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where(condition)
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async find(db, paymentId) {
      return baseQuery(db).where('p.id', '=', paymentId).executeTakeFirst();
    },

    async isOpen(db, paymentId) {
      const row = await db
        .selectFrom('payments as p')
        .innerJoin('orders as o', 'o.id', 'p.order_id')
        .select('p.id')
        .where('p.id', '=', paymentId)
        .where(OPEN)
        .executeTakeFirst();
      return row !== undefined;
    },

    async countOpen(db) {
      const row = await db
        .selectFrom('payments as p')
        .innerJoin('orders as o', 'o.id', 'p.order_id')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where(OPEN)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async resolutions(db, paymentIds) {
      if (paymentIds.length === 0) return [];
      return db
        .selectFrom('payment_review_resolutions as r')
        .innerJoin('admin_users as a', 'a.id', 'r.admin_id')
        .select([
          sql<string>`r.id::text`.as('id'),
          'r.payment_id as paymentId',
          sql<PaymentReviewAction>`r.action`.as('action'),
          'r.amount_minor as amountMinor',
          'r.refund_reference as refundReference',
          'r.note',
          'r.admin_id as adminId',
          'a.display_name as adminName',
          'r.created_at as createdAt',
        ])
        .where('r.payment_id', 'in', [...paymentIds])
        .orderBy('r.id')
        .execute();
    },

    async insertResolution(db, input) {
      await db
        .insertInto('payment_review_resolutions')
        .values({
          payment_id: input.paymentId,
          order_id: input.orderId,
          action: input.action,
          amount_minor: input.amountMinor ?? null,
          refund_reference: input.refundReference ?? null,
          note: input.note,
          admin_id: input.adminId,
        })
        .execute();
    },

    async lockPayment(db, paymentId) {
      return db
        .selectFrom('payments')
        .select(['id', 'status'])
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirst();
    },

    async setPaymentStatus(db, paymentId, status) {
      await db
        .updateTable('payments')
        .set({
          status,
          ...(status === 'success' && { paid_at: sql<Date>`coalesce(paid_at, now())` }),
        })
        .where('id', '=', paymentId)
        .execute();
    },
  };
}
