/**
 * Dashboard data shapes, written with the future admin API in mind (money in minor units,
 * status codes as stored in the database). No endpoint exists yet: see dashboard.mock.ts.
 */

/** orders.order_status codes (order_statuses lookup table). */
export type OrderStatusCode =
  'pending_payment' | 'payment_failed' | 'being_prepared' | 'sent_out' | 'delivered' | 'cancelled';

/** orders.payment_status values. */
export type PaymentStatusCode =
  'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';

export interface DashboardSummary {
  ordersToday: number;
  /** Sum of total_minor for orders paid today, in kobo. */
  paidRevenueTodayMinor: number;
  currency: 'NGN';
  /** Paid orders still in "being_prepared". */
  awaitingProcessing: number;
  /** Active variants with available stock <= low_stock_threshold. */
  lowStockVariants: number;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  totalMinor: number;
  currency: 'NGN';
  paymentStatus: PaymentStatusCode;
  orderStatus: OrderStatusCode;
  sourceClient: 'web' | 'ios' | 'android';
  placedAt: string; // ISO-8601 UTC
}

export interface LowStockItem {
  variantId: string;
  sku: string;
  productName: string;
  sizeLabel: string;
  /** stock_on_hand - stock_reserved */
  available: number;
  lowStockThreshold: number;
}
