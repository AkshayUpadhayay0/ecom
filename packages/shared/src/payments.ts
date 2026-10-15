import { z } from 'zod';

/*
 * Customer payment contract (Phase 6). The client never sends an amount, a status or a "paid"
 * flag: the server reads the total from the order and only a provider-verified transaction
 * marks an order paid.
 */

export const initializePaymentSchema = z.object({ orderId: z.uuid() }).strict();
export type InitializePaymentRequest = z.infer<typeof initializePaymentSchema>;

/** Server-generated references: UI-<order number digits>-<32 hex>. */
export const paymentReferenceSchema = z
  .string()
  .trim()
  .regex(/^UI-[0-9]+-[0-9a-f]{32}$/, 'must be a payment reference');

export const verifyPaymentQuerySchema = z.object({ reference: paymentReferenceSchema }).strict();

export const PAYMENT_STATUSES = [
  'initiated',
  'pending',
  'success',
  'failed',
  'abandoned',
  'refunded',
  'needs_review',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentInitDto {
  reference: string;
  /** Open this (browser / in-app browser) to pay. */
  authorizationUrl: string;
  amountMinor: number;
  currency: string;
  /** Stock stays held until then; pay before it or the order may be cancelled. */
  reservationExpiresAt: string | null;
  /** true while PAYMENT_PROVIDER=mock (no real money). */
  mocked: boolean;
}

/** Latest payment attempt as the customer may see it (no provider payloads, no card data). */
export interface PaymentAttemptDto {
  reference: string;
  status: PaymentStatus;
  failureReason: string | null;
  channel: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface OrderPaymentDto {
  /** orders.payment_status */
  status: string;
  latestAttempt: PaymentAttemptDto | null;
}

/** Result of GET /payments/verify. */
export interface PaymentVerificationDto {
  reference: string;
  paymentStatus: PaymentStatus;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  orderPaymentStatus: string;
}
