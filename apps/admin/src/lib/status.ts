import type { BadgeTone } from '@/components/ui/badge';

/**
 * Display labels and badge tones for status codes returned by the API. Unknown codes (new
 * statuses added later as data) fall back to a readable label, so nothing breaks.
 */
export interface StatusDisplay {
  label: string;
  tone: BadgeTone;
}

type Table = Partial<Record<string, StatusDisplay>>;

const ORDER_STATUS: Table = {
  pending_payment: { label: 'Pending payment', tone: 'neutral' },
  payment_failed: { label: 'Payment failed', tone: 'danger' },
  payment_review: { label: 'Needs attention', tone: 'danger' },
  being_prepared: { label: 'Being prepared', tone: 'warning' },
  sent_out: { label: 'Sent out', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const PAYMENT_STATUS: Table = {
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'info' },
  partially_refunded: { label: 'Partly refunded', tone: 'info' },
  // payments.status (attempts)
  initiated: { label: 'Initiated', tone: 'neutral' },
  success: { label: 'Success', tone: 'success' },
  abandoned: { label: 'Abandoned', tone: 'neutral' },
  needs_review: { label: 'Needs review', tone: 'danger' },
};

const RETURN_STATUS: Table = {
  SUBMITTED: { label: 'Submitted', tone: 'warning' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
  AWAITING_CUSTOMER: { label: 'Awaiting customer', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  AWAITING_RETURN: { label: 'Awaiting return', tone: 'info' },
  RETURN_IN_TRANSIT: { label: 'Return in transit', tone: 'info' },
  RETURN_RECEIVED: { label: 'Item received', tone: 'warning' },
  EXCHANGE_PROCESSING: { label: 'Exchange processing', tone: 'info' },
  EXCHANGE_SENT: { label: 'Replacement sent', tone: 'info' },
  REFUND_PROCESSING: { label: 'Refund processing', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const RESPONSIBILITY: Table = {
  CUSTOMER_FAULT: { label: 'Customer', tone: 'neutral' },
  REVIEW_REQUIRED: { label: 'Review required', tone: 'warning' },
  BRAND_FAULT: { label: 'Brand', tone: 'info' },
};

const PRODUCT_STATUS: Table = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
};

const MEDIA_STATUS: Table = {
  pending: { label: 'Waiting for upload', tone: 'neutral' },
  uploaded: { label: 'Queued', tone: 'info' },
  processing: { label: 'Processing', tone: 'warning' },
  ready: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export function humanise(code: string): string {
  const text = code.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lookup(table: Table, code: string): StatusDisplay {
  return table[code] ?? { label: humanise(code), tone: 'neutral' };
}

export const orderStatusDisplay = (code: string) => lookup(ORDER_STATUS, code);
export const paymentStatusDisplay = (code: string) => lookup(PAYMENT_STATUS, code);
export const returnStatusDisplay = (code: string) => lookup(RETURN_STATUS, code);
export const responsibilityDisplay = (code: string) => lookup(RESPONSIBILITY, code);
export const productStatusDisplay = (code: string) => lookup(PRODUCT_STATUS, code);
export const mediaStatusDisplay = (code: string) => lookup(MEDIA_STATUS, code);

const FIT_METHOD: Table = {
  MANUAL_MEASUREMENTS: { label: 'Quick Fit (measurements typed in)', tone: 'neutral' },
  BODY_SCAN: { label: 'Body Scan', tone: 'neutral' },
};

const SELECTION_MODE: Table = {
  LOCKED_RECOMMENDATION: { label: 'Locked recommendation', tone: 'success' },
  OVERRIDE: { label: 'Customer override', tone: 'warning' },
};

export const fitMethodDisplay = (code: string) => lookup(FIT_METHOD, code);
export const selectionModeDisplay = (code: string) => lookup(SELECTION_MODE, code);

/** Order statuses known today (filters); new statuses added as data still display via humanise. */
export const ORDER_STATUS_CODES = Object.keys(ORDER_STATUS);
export const ORDER_PAYMENT_STATUS_CODES = [
  'unpaid',
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export const RETURN_STATUS_CODES = Object.keys(RETURN_STATUS);
