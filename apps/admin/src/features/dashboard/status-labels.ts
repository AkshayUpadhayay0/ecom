import type { BadgeTone } from '@/components/ui/badge';
import type { OrderStatusCode, PaymentStatusCode } from './dashboard.types';

/**
 * TEMP display labels. Order status labels will come from the API's order_statuses lookup
 * table (admin-extendable) once the orders endpoints exist; unknown codes fall back below.
 */
interface StatusDisplay {
  label: string;
  tone: BadgeTone;
}

const ORDER_STATUS: Record<OrderStatusCode, StatusDisplay> = {
  pending_payment: { label: 'Pending payment', tone: 'neutral' },
  payment_failed: { label: 'Payment failed', tone: 'danger' },
  being_prepared: { label: 'Being prepared', tone: 'warning' },
  sent_out: { label: 'Sent out', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const PAYMENT_STATUS: Record<PaymentStatusCode, StatusDisplay> = {
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'info' },
  partially_refunded: { label: 'Partly refunded', tone: 'info' },
};

function humanise(code: string): string {
  const text = code.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function orderStatusDisplay(code: string): StatusDisplay {
  const known = (ORDER_STATUS as Partial<Record<string, StatusDisplay>>)[code];
  return known ?? { label: humanise(code), tone: 'neutral' };
}

export function paymentStatusDisplay(code: string): StatusDisplay {
  const known = (PAYMENT_STATUS as Partial<Record<string, StatusDisplay>>)[code];
  return known ?? { label: humanise(code), tone: 'neutral' };
}
