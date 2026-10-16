import type { StatsOverviewDto } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { STORE_UTC_OFFSET_MINUTES } from '../orders/admin-orders.service.js';
import type { PaymentReviewsRepository } from '../payments/payment-reviews.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StatsRepository } from './stats.repository.js';

const MS_PER_MINUTE = 60_000;
const DAY_MS = 24 * 60 * MS_PER_MINUTE;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const PAYMENT_REVIEW = 'payment_review';

export interface StatsService {
  /** Real counts; cached for `cacheMs` so the dashboard can poll cheaply. */
  overview(): Promise<StatsOverviewDto>;
  /** Drops the cache (tests). */
  clearCache(): void;
}

/** Start of the current store day (Assumption: WAT, see STORE_UTC_OFFSET_MINUTES). */
function startOfStoreDay(now: Date): Date {
  const offsetMs = STORE_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
  const local = new Date(now.getTime() + offsetMs);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs,
  );
}

export function createStatsService(deps: {
  db: Database;
  repository: StatsRepository;
  reviews: PaymentReviewsRepository;
  settings: SettingsService;
  cacheMs: number;
}): StatsService {
  const { db, repository, reviews, settings } = deps;
  let cached: { at: number; value: StatsOverviewDto } | undefined;

  async function compute(): Promise<StatsOverviewDto> {
    const now = new Date();
    const today = startOfStoreDay(now);
    const [byStatus, paid, stock, failedMedia, returns, openReviews, currency] = await Promise.all([
      repository.ordersByStatus(db),
      repository.paidWindows(db, {
        today,
        week: new Date(today.getTime() - (WEEK_DAYS - 1) * DAY_MS),
        month: new Date(today.getTime() - (MONTH_DAYS - 1) * DAY_MS),
      }),
      repository.stockCounts(db),
      repository.failedMediaJobs(db),
      repository.returnCounts(db),
      reviews.countOpen(db),
      settings.getSetting(db, 'store.currency'),
    ]);
    const ordersByStatus = Object.fromEntries(byStatus.map((row) => [row.status, row.count]));
    return {
      generatedAt: now.toISOString(),
      currency,
      ordersByStatus,
      paid: {
        today: { orders: paid.todayOrders, revenueMinor: int8ToNumber(paid.todayRevenue) },
        last7Days: { orders: paid.weekOrders, revenueMinor: int8ToNumber(paid.weekRevenue) },
        last30Days: { orders: paid.monthOrders, revenueMinor: int8ToNumber(paid.monthRevenue) },
      },
      ordersNeedingAttention: ordersByStatus[PAYMENT_REVIEW] ?? 0,
      paymentsNeedingReview: openReviews,
      lowStockVariants: stock.lowStock,
      outOfStockVariants: stock.outOfStock,
      failedMediaJobs: failedMedia,
      openReturns: returns.open,
      returnsAwaitingAction: returns.awaitingAction,
    };
  }

  return {
    async overview() {
      if (cached && Date.now() - cached.at < deps.cacheMs) return cached.value;
      const value = await compute();
      cached = { at: Date.now(), value };
      return value;
    },
    clearCache() {
      cached = undefined;
    },
  };
}
