import { z } from 'zod';

export type EmailTemplate =
  | 'email_verification'
  | 'password_reset'
  | 'order_confirmation'
  | 'order_sent_out'
  | 'order_delivered';

/** Payload of the account emails (verification / password reset). */
export interface AccountEmailPayload {
  fullName: string;
  link: string;
}

const accountPayloadSchema = z.object({ fullName: z.string(), link: z.string() });

/** Snapshot taken from the order when payment is confirmed. No payment data. */
const orderConfirmationSchema = z.object({
  orderNumber: z.string(),
  currency: z.string(),
  recipientName: z.string(),
  items: z.array(
    z.object({
      productName: z.string(),
      sizeLabel: z.string(),
      quantity: z.number().int(),
      unitPriceMinor: z.number().int(),
      lineTotalMinor: z.number().int(),
    }),
  ),
  subtotalMinor: z.number().int(),
  deliveryFeeMinor: z.number().int(),
  totalMinor: z.number().int(),
  delivery: z.object({
    addressLine1: z.string(),
    addressLine2: z.string().nullable(),
    city: z.string(),
    state: z.string().nullable(),
    landmark: z.string().nullable(),
    zoneName: z.string(),
  }),
});
export type OrderConfirmationPayload = z.infer<typeof orderConfirmationSchema>;

/** Payload of the admin-triggered status emails (sent out / delivered). No payment data. */
const orderStatusEmailSchema = z.object({
  orderNumber: z.string(),
  recipientName: z.string(),
  carrier: z.string().nullable(),
  trackingReference: z.string().nullable(),
});
export type OrderStatusEmailPayload = z.infer<typeof orderStatusEmailSchema>;

export type EmailPayload = AccountEmailPayload | OrderConfirmationPayload | OrderStatusEmailPayload;

/**
 * Templates whose payload contains a one-time secret link. Their payload is replaced after
 * sending so the raw token does not stay in the database.
 */
export const SENSITIVE_TEMPLATES: ReadonlySet<string> = new Set<EmailTemplate>([
  'email_verification',
  'password_reset',
]);

export interface RenderedEmail {
  subject: string;
  text: string;
}

const DEFAULT_LANGUAGE = 'en';
const MINOR_PER_MAJOR = 100;

/**
 * Order-confirmation copy per language. TEMP English only; approved Pidgin copy (client's writer)
 * is added as a 'pcm' entry later without touching the rendering code.
 */
const ORDER_CONFIRMATION_COPY = {
  en: {
    subject: (orderNumber: string) => `Your Urban Ibile order ${orderNumber} is confirmed`,
    greeting: (name: string) => `Hi ${name},`,
    intro: 'Thank you. We have received your payment and your order is being prepared.',
    orderLabel: 'Order',
    itemsLabel: 'Items',
    sizeLabel: 'Size',
    subtotalLabel: 'Subtotal',
    deliveryLabel: 'Delivery',
    totalLabel: 'Total',
    addressLabel: 'Delivery address',
    outro: 'We will let you know when your order is sent out.',
  },
} as const;
type OrderCopy = (typeof ORDER_CONFIRMATION_COPY)[typeof DEFAULT_LANGUAGE];

function copyFor(language: string): OrderCopy {
  return language in ORDER_CONFIRMATION_COPY
    ? ORDER_CONFIRMATION_COPY[language as keyof typeof ORDER_CONFIRMATION_COPY]
    : ORDER_CONFIRMATION_COPY[DEFAULT_LANGUAGE];
}

/** Display only (integer arithmetic, no floats): 1500000 NGN -> "NGN 15,000.00". */
export function formatMoney(minor: number, currency: string): string {
  const major = Math.trunc(minor / MINOR_PER_MAJOR).toLocaleString('en-US');
  const fraction = String(minor % MINOR_PER_MAJOR).padStart(2, '0');
  return `${currency} ${major}.${fraction}`;
}

function renderOrderConfirmation(
  payload: OrderConfirmationPayload,
  language: string,
): RenderedEmail {
  const copy = copyFor(language);
  const money = (minor: number) => formatMoney(minor, payload.currency);
  const items = payload.items.map(
    (item) =>
      `- ${item.productName} (${copy.sizeLabel} ${item.sizeLabel}) x ${item.quantity} @ ${money(item.unitPriceMinor)} = ${money(item.lineTotalMinor)}`,
  );
  const d = payload.delivery;
  const address = [d.addressLine1, d.addressLine2, d.landmark, d.city, d.state, d.zoneName].filter(
    (part): part is string => part !== null && part !== '',
  );
  const text = [
    copy.greeting(payload.recipientName),
    '',
    copy.intro,
    '',
    `${copy.orderLabel}: ${payload.orderNumber}`,
    '',
    `${copy.itemsLabel}:`,
    ...items,
    '',
    `${copy.subtotalLabel}: ${money(payload.subtotalMinor)}`,
    `${copy.deliveryLabel}: ${money(payload.deliveryFeeMinor)}`,
    `${copy.totalLabel}: ${money(payload.totalMinor)}`,
    '',
    `${copy.addressLabel}:`,
    payload.recipientName,
    ...address,
    '',
    copy.outro,
  ].join('\n');
  return { subject: copy.subject(payload.orderNumber), text };
}

/**
 * Status email copy per language. TEMP English only; approved Pidgin copy is added as a 'pcm'
 * entry later without touching the rendering code.
 */
const ORDER_STATUS_COPY = {
  en: {
    order_sent_out: {
      subject: (orderNumber: string) => `Your Urban Ibile order ${orderNumber} is on its way`,
      body: 'Good news: your order has been sent out.',
    },
    order_delivered: {
      subject: (orderNumber: string) => `Your Urban Ibile order ${orderNumber} was delivered`,
      body: 'Your order has been delivered. We hope you love it.',
    },
    greeting: (name: string) => `Hi ${name},`,
    orderLabel: 'Order',
    carrierLabel: 'Carrier',
    trackingLabel: 'Tracking reference',
  },
} as const;
type StatusCopy = (typeof ORDER_STATUS_COPY)[typeof DEFAULT_LANGUAGE];

function statusCopyFor(language: string): StatusCopy {
  return language in ORDER_STATUS_COPY
    ? ORDER_STATUS_COPY[language as keyof typeof ORDER_STATUS_COPY]
    : ORDER_STATUS_COPY[DEFAULT_LANGUAGE];
}

function renderOrderStatusEmail(
  template: 'order_sent_out' | 'order_delivered',
  payload: OrderStatusEmailPayload,
  language: string,
): RenderedEmail {
  const copy = statusCopyFor(language);
  const lines = [
    copy.greeting(payload.recipientName),
    '',
    copy[template].body,
    '',
    `${copy.orderLabel}: ${payload.orderNumber}`,
    ...(payload.carrier === null ? [] : [`${copy.carrierLabel}: ${payload.carrier}`]),
    ...(payload.trackingReference === null
      ? []
      : [`${copy.trackingLabel}: ${payload.trackingReference}`]),
  ];
  return { subject: copy[template].subject(payload.orderNumber), text: lines.join('\n') };
}

/**
 * TEMP: plain-text templates. Final copy, Pidgin versions and HTML layout arrive with the email
 * provider decision. Account emails are English only for now.
 */
export function renderEmail(
  template: string,
  rawPayload: unknown,
  language = DEFAULT_LANGUAGE,
): RenderedEmail {
  switch (template) {
    case 'email_verification': {
      const payload = accountPayloadSchema.parse(rawPayload);
      return {
        subject: 'Confirm your Urban Ibile email',
        text: `Hi ${payload.fullName},\n\nConfirm your email address by opening this link:\n${payload.link}\n\nIf you did not create an account, ignore this email.`,
      };
    }
    case 'password_reset': {
      const payload = accountPayloadSchema.parse(rawPayload);
      return {
        subject: 'Reset your Urban Ibile password',
        text: `Hi ${payload.fullName},\n\nReset your password with this link:\n${payload.link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`,
      };
    }
    case 'order_sent_out':
    case 'order_delivered':
      return renderOrderStatusEmail(template, orderStatusEmailSchema.parse(rawPayload), language);
    case 'order_confirmation':
      return renderOrderConfirmation(orderConfirmationSchema.parse(rawPayload), language);
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
