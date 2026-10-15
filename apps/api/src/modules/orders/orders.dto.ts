import { z } from 'zod';
import type {
  OrderPaymentDto,
  OrderDto,
  OrderFitSummaryDto,
  OrderItemDto,
  OrderSummaryDto,
} from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { PaymentRow } from '../payments/payments.repository.js';
import type { OrderItemRow, OrderRow } from './orders.repository.js';

/** The readable part of order_items.fit_snapshot (written by checkout). */
const fitSnapshotSchema = z.object({
  method: z.string(),
  selectionMode: z.string(),
  fitPreference: z.string(),
  recommendedSize: z.string(),
  selectedSize: z.string(),
});

function fitOf(snapshot: unknown): OrderFitSummaryDto | null {
  const result = fitSnapshotSchema.safeParse(snapshot);
  return result.success ? result.data : null;
}

export function toOrderItemDto(row: OrderItemRow): OrderItemDto {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    sizeLabel: row.sizeLabel,
    sku: row.sku,
    quantity: row.quantity,
    unitPriceMinor: int8ToNumber(row.unitPriceMinor),
    lineTotalMinor: int8ToNumber(row.lineTotalMinor),
    fit: fitOf(row.fitSnapshot),
  };
}

function baseOf(row: OrderRow): Omit<OrderSummaryDto, 'itemCount'> {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    orderStatus: row.orderStatus,
    paymentStatus: row.paymentStatus,
    currency: row.currency.trim(),
    totalMinor: int8ToNumber(row.totalMinor),
    placedAt: row.placedAt.toISOString(),
  };
}

export function toOrderSummaryDto(row: OrderRow & { itemCount: number }): OrderSummaryDto {
  return { ...baseOf(row), itemCount: row.itemCount };
}

function toPaymentDto(row: OrderRow, latest: PaymentRow | undefined): OrderPaymentDto {
  return {
    status: row.paymentStatus,
    latestAttempt: latest
      ? {
          reference: latest.reference,
          status: latest.status,
          failureReason: latest.failureReason,
          channel: latest.channel,
          createdAt: latest.createdAt.toISOString(),
          paidAt: latest.paidAt?.toISOString() ?? null,
        }
      : null,
  };
}

/**
 * Customer view: never includes internal_note, provider payloads or card data; the payment part
 * is the order's payment status and the latest attempt's state only.
 */
export function toOrderDto(
  row: OrderRow,
  items: readonly OrderItemRow[],
  latestPayment?: PaymentRow,
): OrderDto {
  return {
    ...baseOf(row),
    subtotalMinor: int8ToNumber(row.subtotalMinor),
    deliveryFeeMinor: int8ToNumber(row.deliveryFeeMinor),
    contact: { email: row.contactEmail, phone: row.contactPhone },
    delivery: {
      recipientName: row.recipientName,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      landmark: row.landmark,
      zoneName: row.deliveryZoneName,
    },
    items: items.map(toOrderItemDto),
    reservationExpiresAt: row.reservationExpiresAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    payment: toPaymentDto(row, latestPayment),
  };
}
