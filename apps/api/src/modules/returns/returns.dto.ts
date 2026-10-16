import type {
  AdminReturnSummaryDto,
  CustomerReturnSummaryDto,
  CustomerReturnTimelineEventDto,
  ReturnPayer,
  ReturnRefundInfoDto,
  ReturnRequestType,
  ReturnResponsibility,
} from '@urban-ibile/shared';
import { returnCostsLabel } from './responsibility.js';
import type { ReturnEventRow, ReturnRow } from './returns.repository.js';

/** Stated on every return: no money moves through this API (Pending Client Decision). */
export const REFUND_INFO: ReturnRefundInfoDto = {
  executed: false,
  policy: 'PENDING_CLIENT_DECISION',
};

// CHECK-constrained columns, narrowed for the DTOs.
const typeOf = (row: ReturnRow) => row.requestType as ReturnRequestType;
const payerOf = (row: ReturnRow) => row.payer as ReturnPayer;

export function toCustomerSummary(row: ReturnRow): CustomerReturnSummaryDto {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    orderItemId: row.orderItemId,
    requestType: typeOf(row),
    reasonCode: row.reasonCode,
    quantity: row.quantity,
    status: row.status,
    statusLabel: row.statusLabel,
    product: { name: row.productName, sizeLabel: row.sizeLabel },
    returnCosts: { payer: payerOf(row), label: returnCostsLabel(payerOf(row)) },
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Customer timeline: CUSTOMER-visible events only; who acted, never admin names or ids. */
export function toCustomerTimeline(
  events: readonly ReturnEventRow[],
): CustomerReturnTimelineEventDto[] {
  return events
    .filter((e) => e.visibility === 'CUSTOMER')
    .map((e) => ({
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      message: e.note,
      by: e.actorType === 'CUSTOMER' ? 'you' : 'urban_ibile',
      createdAt: e.createdAt.toISOString(),
    }));
}

export function toAdminSummary(row: ReturnRow): AdminReturnSummaryDto {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    status: row.status,
    requestType: typeOf(row),
    reasonCode: row.reasonCode,
    quantity: row.quantity,
    responsibility: row.responsibility as ReturnResponsibility,
    faultCause: row.faultCause,
    payer: payerOf(row),
    order: { id: row.orderId, orderNumber: row.orderNumber },
    customer: { id: row.customerId, fullName: row.customerName, email: row.customerEmail },
    product: { name: row.productName, sku: row.sku, sizeLabel: row.sizeLabel },
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
