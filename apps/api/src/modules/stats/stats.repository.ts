import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface PaidWindowRow {
  todayOrders: number;
  todayRevenue: string;
  weekOrders: number;
  weekRevenue: string;
  monthOrders: number;
  monthRevenue: string;
}

export interface StockCountsRow {
  lowStock: number;
  outOfStock: number;
}

/** Cheap aggregate counts for the admin dashboard (indexed columns only). */
export interface StatsRepository {
  ordersByStatus(db: Database): Promise<{ status: string; count: number }[]>;
  /** Paid orders by paid_at since the given instants (ix_orders_paid_at). */
  paidWindows(
    db: Database,
    since: { today: Date; week: Date; month: Date },
  ): Promise<PaidWindowRow>;
  stockCounts(db: Database): Promise<StockCountsRow>;
  failedMediaJobs(db: Database): Promise<number>;
  /** Open return requests, and those waiting for an admin action. */
  returnCounts(db: Database): Promise<{ open: number; awaitingAction: number }>;
}

export function createStatsRepository(): StatsRepository {
  return {
    async ordersByStatus(db) {
      return db
        .selectFrom('orders')
        .select(['order_status as status', sql<number>`count(*)::int`.as('count')])
        .groupBy('order_status')
        .execute();
    },

    async paidWindows(db, since) {
      const result = await sql<PaidWindowRow>`
        SELECT
          count(*) FILTER (WHERE paid_at >= ${since.today})::int AS "todayOrders",
          coalesce(sum(total_minor) FILTER (WHERE paid_at >= ${since.today}), 0)::text AS "todayRevenue",
          count(*) FILTER (WHERE paid_at >= ${since.week})::int AS "weekOrders",
          coalesce(sum(total_minor) FILTER (WHERE paid_at >= ${since.week}), 0)::text AS "weekRevenue",
          count(*)::int AS "monthOrders",
          coalesce(sum(total_minor), 0)::text AS "monthRevenue"
        FROM orders
        WHERE payment_status = 'paid' AND paid_at >= ${since.month}`.execute(db);
      const row = result.rows[0];
      if (!row) throw new Error('aggregate returned no row');
      return row;
    },

    async stockCounts(db) {
      // Same rule as the inventory low-stock list: active variants of non-archived products.
      const result = await sql<StockCountsRow>`
        SELECT
          count(*) FILTER (WHERE v.stock_on_hand - v.stock_reserved > 0
                             AND v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold)::int AS "lowStock",
          count(*) FILTER (WHERE v.stock_on_hand - v.stock_reserved <= 0)::int AS "outOfStock"
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.is_active AND p.status <> 'archived'`.execute(db);
      const row = result.rows[0];
      if (!row) throw new Error('aggregate returned no row');
      return row;
    },

    async returnCounts(db) {
      const result = await sql<{ open: number; awaitingAction: number }>`
        SELECT
          count(*) FILTER (WHERE status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED'))::int AS "open",
          count(*) FILTER (WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'RETURN_RECEIVED'))::int AS "awaitingAction"
        FROM return_requests`.execute(db);
      return result.rows[0] ?? { open: 0, awaitingAction: 0 };
    },

    async failedMediaJobs(db) {
      const row = await db
        .selectFrom('media_assets')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('processing_status', '=', 'failed')
        .where('retired_at', 'is', null)
        .executeTakeFirstOrThrow();
      return row.n;
    },
  };
}
