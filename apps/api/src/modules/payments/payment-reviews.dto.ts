import type { PaymentReviewDto, PaymentReviewResolutionDto } from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { PaymentReviewRow, ResolutionRow } from './payment-reviews.repository.js';

export function toResolutionDto(row: ResolutionRow): PaymentReviewResolutionDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    action: row.action,
    amountMinor: row.amountMinor === null ? null : int8ToNumber(row.amountMinor),
    refundReference: row.refundReference,
    note: row.note,
    admin: { id: row.adminId, name: row.adminName },
    createdAt: row.createdAt.toISOString(),
  };
}

/** Amount / currency the provider reported, falling back to the attempt's own values. */
export function receivedOf(row: PaymentReviewRow): { amountMinor: number; currency: string } {
  const reported = row.receivedAmountMinor === null ? NaN : Number(row.receivedAmountMinor);
  return {
    amountMinor: Number.isSafeInteger(reported) ? reported : int8ToNumber(row.amountMinor),
    currency: (row.receivedCurrency ?? row.currency).trim(),
  };
}

export function toPaymentReviewDto(
  row: PaymentReviewRow,
  resolutions: readonly ResolutionRow[],
  open: boolean,
): PaymentReviewDto {
  const received = receivedOf(row);
  const refundRequired = resolutions.find((r) => r.action === 'MARK_REFUND_REQUIRED');
  const refunded = resolutions.some((r) => r.action === 'MARK_REFUNDED');
  return {
    paymentId: row.paymentId,
    reference: row.reference,
    reason: row.reason ?? 'UNKNOWN',
    paymentStatus: row.paymentStatus,
    order: {
      id: row.orderId,
      orderNumber: row.orderNumber,
      orderStatus: row.orderStatus,
      paymentStatus: row.orderPaymentStatus,
      totalMinor: int8ToNumber(row.orderTotalMinor),
      currency: row.orderCurrency.trim(),
    },
    customer: { id: row.customerId, fullName: row.customerName, email: row.customerEmail },
    receivedAmountMinor: received.amountMinor,
    receivedCurrency: received.currency,
    refundOwedMinor:
      refundRequired?.amountMinor != null && !refunded
        ? int8ToNumber(refundRequired.amountMinor)
        : null,
    open,
    createdAt: row.createdAt.toISOString(),
    resolutions: resolutions.map(toResolutionDto),
  };
}
