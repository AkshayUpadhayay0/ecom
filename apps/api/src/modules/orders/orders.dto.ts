import { z } from 'zod';
import type {
  OrderDto,
  OrderFitSummaryDto,
  OrderItemDto,
  OrderSummaryDto,
} from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
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

/** Customer view: never includes internal_note or reservation internals beyond the expiry. */
export function toOrderDto(row: OrderRow, items: readonly OrderItemRow[]): OrderDto {
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
  };
}
