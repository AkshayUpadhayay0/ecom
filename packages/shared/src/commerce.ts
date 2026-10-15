import { z } from 'zod';
import { MAX_PAGE_SIZE } from './admin-common.js';
import { AUTH_CLIENTS, emailSchema } from './auth.js';
import type { SelectionMode } from './blueprint.js';
import type { OrderPaymentDto } from './payments.js';

/*
 * Customer commerce contract (cart, addresses, delivery quote, checkout, orders). Money is
 * always integer minor units; prices and totals are computed by the server only.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'must be a phone number');

// ---------- Addresses ----------

const addressFields = {
  label: optionalText(60),
  recipientName: text(120),
  phone: phoneSchema,
  addressLine1: text(200),
  addressLine2: optionalText(200),
  city: text(100),
  state: optionalText(100),
  landmark: optionalText(200),
  deliveryZoneId: z.uuid(),
};

export const createAddressSchema = z.object({
  ...addressFields,
  isDefault: z.boolean().default(false),
});
export type CreateAddressRequest = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z
  .object({
    label: optionalText(60),
    recipientName: text(120).optional(),
    phone: phoneSchema.optional(),
    addressLine1: text(200).optional(),
    addressLine2: optionalText(200),
    city: text(100).optional(),
    state: optionalText(100),
    landmark: optionalText(200),
    deliveryZoneId: z.uuid().optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateAddressRequest = z.infer<typeof updateAddressSchema>;

export interface AddressDto {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZone: { id: string; code: string; name: string };
  isDefault: boolean;
}

// ---------- Delivery ----------

export interface CustomerDeliveryZoneDto {
  id: string;
  code: string;
  name: string;
  feeMinor: number;
  estDaysMin: number | null;
  estDaysMax: number | null;
}

// ---------- Cart ----------

export const addCartItemSchema = z.object({
  productId: z.uuid(),
  /** Required for products without a measurement profile (otherwise the decision's size). */
  sizeId: z.uuid().optional(),
  /** Required when the product uses Blueprint; its selected size decides the variant. */
  blueprintDecisionId: z.uuid().optional(),
  quantity: z.number().int().min(1),
});
export type AddCartItemRequest = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({ quantity: z.number().int().min(1) });
export const replaceCartDecisionSchema = z.object({ blueprintDecisionId: z.uuid() });

export const CART_WARNINGS = ['PRICE_CHANGED', 'STOCK_LOW', 'OUT_OF_STOCK', 'UNAVAILABLE'] as const;
export type CartWarning = (typeof CART_WARNINGS)[number];

export interface CartLineDto {
  id: string;
  product: { id: string; slug: string; name: string };
  size: { id: string; code: string; label: string };
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  /** Price when the line was added (only to explain PRICE_CHANGED). */
  addedUnitPriceMinor: number | null;
  decision: { id: string; selectionMode: SelectionMode; recommendedSizeCode: string } | null;
  /** STOCK_LOW: fewer available than requested. OUT_OF_STOCK: none. UNAVAILABLE: inactive. */
  warnings: CartWarning[];
}

export interface CartDto {
  id: string;
  currency: string;
  lines: CartLineDto[];
  itemCount: number;
  /** Sum of purchasable lines at current prices. */
  subtotalMinor: number;
  /** false while any line has STOCK_LOW, OUT_OF_STOCK or UNAVAILABLE, or the cart is empty. */
  canCheckout: boolean;
  maxQuantityPerLine: number;
}

// ---------- Quote + checkout ----------

export const quoteSchema = z
  .object({ addressId: z.uuid().optional(), zoneId: z.uuid().optional() })
  .refine((body) => (body.addressId === undefined) !== (body.zoneId === undefined), {
    message: 'Provide exactly one of addressId or zoneId',
  });
export type QuoteRequest = z.infer<typeof quoteSchema>;

export interface QuoteDto {
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  zone: CustomerDeliveryZoneDto;
  canCheckout: boolean;
}

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'must be 8-128 letters, digits or - _ . :');

export const checkoutSchema = z
  .object({
    client: z.enum(AUTH_CLIENTS),
    contactEmail: emailSchema,
    contactPhone: phoneSchema,
    /** A saved address of this customer... */
    addressId: z.uuid().optional(),
    /** ...or a new one (saved to the customer's addresses). */
    address: z.object(addressFields).optional(),
    language: z.string().trim().min(2).max(10).optional(),
  })
  .refine((body) => (body.addressId === undefined) !== (body.address === undefined), {
    message: 'Provide exactly one of addressId or address',
  });
export type CheckoutRequest = z.infer<typeof checkoutSchema>;

// ---------- Orders ----------

export const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export interface OrderFitSummaryDto {
  method: string;
  selectionMode: string;
  fitPreference: string;
  recommendedSize: string;
  selectedSize: string;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productName: string;
  sizeLabel: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  fit: OrderFitSummaryDto | null;
}

export interface OrderSummaryDto {
  id: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  totalMinor: number;
  itemCount: number;
  placedAt: string;
}

export interface OrderDto extends Omit<OrderSummaryDto, 'itemCount'> {
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
    zoneName: string;
  };
  items: OrderItemDto[];
  /** Stock is held until then (pending payment only). */
  reservationExpiresAt: string | null;
  cancelReason: string | null;
  payment: OrderPaymentDto;
}
