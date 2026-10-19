import { z } from 'zod';
import { booleanQuerySchema, paginationQuerySchema } from './admin-common.js';

/* Admin order management, payment review queue, customer lookup, dashboard stats (Phase 7a). */

const statusCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'must be a status code');
const reasonSchema = z.string().trim().min(1).max(500);
const noteSchema = z.string().trim().min(1).max(2000);
const isoDateSchema = z.iso.datetime({ offset: true }).or(z.iso.date());
const searchTermSchema = z.string().trim().min(2).max(100);

export const ADMIN_ORDER_SORTS = ['placedAt', 'total'] as const;

export const listAdminOrdersQuerySchema = paginationQuerySchema
  .extend({
    orderStatus: statusCodeSchema.optional(),
    paymentStatus: z
      .enum(['unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'])
      .optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    deliveryZoneId: z.uuid().optional(),
    /** payment_review orders (money received, needs attention). */
    needsAttention: booleanQuerySchema.optional(),
    /** Order number, customer name, email or phone. */
    q: searchTermSchema.optional(),
    sort: z.enum(ADMIN_ORDER_SORTS).default('placedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type ListAdminOrdersQuery = z.infer<typeof listAdminOrdersQuerySchema>;

export const updateOrderStatusSchema = z
  .object({
    toStatus: statusCodeSchema,
    /** Optimistic concurrency: the status the admin saw. A different current status = 409. */
    expectedStatus: statusCodeSchema,
    /** Required when the transition requires a reason (cancellation). */
    reason: reasonSchema.optional(),
    /** Optional on sent_out. */
    carrier: z.string().trim().min(1).max(100).optional(),
    trackingReference: z.string().trim().min(1).max(200).optional(),
    /** Cancel even though a payment attempt is still in flight (PAYMENT_IN_PROGRESS). */
    confirmInFlight: z.boolean().optional(),
  })
  .strict();
export type UpdateOrderStatusRequest = z.infer<typeof updateOrderStatusSchema>;

export const createOrderNoteSchema = z.object({ body: noteSchema }).strict();

export const PAYMENT_REVIEW_ACTIONS = ['FULFIL', 'MARK_REFUND_REQUIRED', 'MARK_REFUNDED'] as const;
export type PaymentReviewAction = (typeof PAYMENT_REVIEW_ACTIONS)[number];

export const resolvePaymentReviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('FULFIL'), note: noteSchema }).strict(),
  z
    .object({
      action: z.literal('MARK_REFUND_REQUIRED'),
      note: noteSchema,
      amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z
    .object({
      action: z.literal('MARK_REFUNDED'),
      note: noteSchema,
      /** Reference of the refund done manually in the Paystack dashboard. */
      refundReference: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export type ResolvePaymentReviewRequest = z.infer<typeof resolvePaymentReviewSchema>;

export const listPaymentReviewsQuerySchema = paginationQuerySchema
  .extend({ state: z.enum(['open', 'all']).default('open') })
  .strict();

export const listAdminCustomersQuerySchema = paginationQuerySchema
  .extend({
    q: searchTermSchema.optional(),
    status: z.enum(['active', 'suspended', 'deleted']).optional(),
  })
  .strict();

export const updateCustomerStatusSchema = z
  .object({ status: z.enum(['active', 'suspended']), reason: reasonSchema })
  .strict();

// ---------- DTOs ----------

export interface AdminOrderSummaryDto {
  id: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  needsAttention: boolean;
  customer: { id: string; fullName: string; email: string };
  recipientName: string;
  contactPhone: string;
  deliveryZoneName: string;
  currency: string;
  totalMinor: number;
  itemCount: number;
  placedAt: string;
  paidAt: string | null;
}

export interface AdminMeasurementDto {
  code: string;
  label: string;
  valueInches: number;
  requiredSize: string;
}

export interface AdminOrderItemDto {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  clothingTypeName: string;
  sizeLabel: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  /** Readable fit snapshot stored at purchase (null for products without Blueprint). */
  fit: {
    decisionId: string;
    method: string;
    selectionMode: string;
    fitPreference: string;
    recommendedSize: string;
    selectedSize: string;
    /** Size chart group + version used for the decision (stored at purchase). */
    charts: { group: string; version: number }[];
  } | null;
  /** Body measurements recorded with the decision (inches). */
  measurements: AdminMeasurementDto[];
}

/** Every attempt; never the raw gateway payload. */
export interface AdminPaymentAttemptDto {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  channel: string | null;
  failureReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
  paidAt: string | null;
}

export interface AdminActorDto {
  type: 'admin' | 'system';
  id: string | null;
  name: string | null;
}

export interface AdminOrderHistoryDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actor: AdminActorDto;
  createdAt: string;
}

export interface AdminOrderNoteDto {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
}

export interface PaymentReviewResolutionDto {
  id: string;
  paymentId: string;
  action: PaymentReviewAction;
  amountMinor: number | null;
  refundReference: string | null;
  note: string;
  admin: { id: string; name: string };
  createdAt: string;
}

export interface AdminOrderDetailDto extends AdminOrderSummaryDto {
  sourceClient: string;
  languageCode: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  contact: { email: string; phone: string };
  delivery: {
    recipientName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    landmark: string | null;
    zoneId: string | null;
    zoneName: string;
  };
  carrier: string | null;
  trackingReference: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reservationExpiresAt: string | null;
  items: AdminOrderItemDto[];
  payments: AdminPaymentAttemptDto[];
  history: AdminOrderHistoryDto[];
  notes: AdminOrderNoteDto[];
  reviewResolutions: PaymentReviewResolutionDto[];
  /** Status changes an admin may make now (from order_status_transitions). */
  allowedTransitions: { toStatus: string; requiresPaid: boolean; requiresReason: boolean }[];
}

export const PAYMENT_REVIEW_REASONS = [
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'ORDER_MISMATCH',
  'DUPLICATE_SUCCESS',
  'LATE_NO_STOCK',
] as const;

export interface PaymentReviewDto {
  paymentId: string;
  reference: string;
  /** One of PAYMENT_REVIEW_REASONS (or another stored reason code). */
  reason: string;
  paymentStatus: string;
  order: {
    id: string;
    orderNumber: string;
    orderStatus: string;
    paymentStatus: string;
    totalMinor: number;
    currency: string;
  };
  customer: { id: string; fullName: string; email: string };
  /** What the provider reported (from the stored verify summary). */
  receivedAmountMinor: number;
  receivedCurrency: string;
  /** Refund recorded as owed and not yet marked refunded. */
  refundOwedMinor: number | null;
  open: boolean;
  createdAt: string;
  resolutions: PaymentReviewResolutionDto[];
}

export interface AdminCustomerSummaryDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  orderCount: number;
  paidTotalMinor: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminCustomerDetailDto extends AdminCustomerSummaryDto {
  preferredLanguage: string;
  lockedUntil: string | null;
  addresses: {
    id: string;
    label: string | null;
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    landmark: string | null;
    zoneName: string;
    isDefault: boolean;
  }[];
  orders: {
    id: string;
    orderNumber: string;
    orderStatus: string;
    paymentStatus: string;
    currency: string;
    totalMinor: number;
    placedAt: string;
  }[];
}

export interface StatsOverviewDto {
  generatedAt: string;
  currency: string;
  ordersByStatus: Record<string, number>;
  paid: {
    today: { orders: number; revenueMinor: number };
    last7Days: { orders: number; revenueMinor: number };
    last30Days: { orders: number; revenueMinor: number };
  };
  ordersNeedingAttention: number;
  paymentsNeedingReview: number;
  lowStockVariants: number;
  outOfStockVariants: number;
  /** Developer-only (super_admin): omitted from the response for role admin (19 Oct 2026). */
  failedMediaJobs?: number;
  /** Return requests not completed / rejected / cancelled. */
  openReturns: number;
  /** Open returns waiting for an admin (submitted, under review, item received). */
  returnsAwaitingAction: number;
}
