import { createHash } from 'node:crypto';
import type {
  CheckoutRequest,
  CustomerDeliveryZoneDto,
  OrderDto,
  QuoteDto,
  QuoteRequest,
} from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { PG_ERROR, int8ToNumber, isPgErrorCode } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { CartService } from '../cart/cart.service.js';
import { decisionProblem, isUnavailable } from '../cart/cart-lines.js';
import type { CartLineRow, CartRepository } from '../cart/cart.repository.js';
import type { AddressesService } from '../customers/addresses.service.js';
import type { AddressesRepository } from '../customers/addresses.repository.js';
import type {
  DeliveryZoneRow,
  DeliveryZonesRepository,
} from '../delivery/delivery-zones.repository.js';
import { releaseOrderHolds } from '../inventory/order-holds.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import { toOrderDto } from '../orders/orders.dto.js';
import type {
  NewOrderItem,
  OrderItemRow,
  OrderRow,
  OrdersRepository,
} from '../orders/orders.repository.js';
import type { PaymentsRepository } from '../payments/payments.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { IdempotencyRepository } from './idempotency.repository.js';

const IDEMPOTENCY_SCOPE = 'checkout.order';
const PENDING_PAYMENT = 'pending_payment';
const CANCELLED = 'cancelled';
const MS_PER_MINUTE = 60_000;
/** SQLSTATE of RAISE EXCEPTION in our triggers (check_line_matches_decision). */
const RAISE_EXCEPTION = 'P0001';

export const CANCEL_REASONS = {
  SUPERSEDED: 'superseded_by_new_checkout',
  EXPIRED: 'reservation_expired',
} as const;

export interface CheckoutResult {
  order: OrderDto;
  /** false when an earlier request (same key) or the unchanged open order was returned. */
  created: boolean;
}

export interface CheckoutService {
  zones(): Promise<CustomerDeliveryZoneDto[]>;
  quote(customerId: string, input: QuoteRequest): Promise<QuoteDto>;
  createOrder(
    customerId: string,
    idempotencyKey: string,
    input: CheckoutRequest,
  ): Promise<CheckoutResult>;
}

export interface CheckoutServiceDeps {
  db: Database;
  logger: Logger;
  cart: CartService;
  carts: CartRepository;
  addresses: AddressesService;
  addressRows: AddressesRepository;
  zones: DeliveryZonesRepository;
  orders: OrdersRepository;
  reservations: ReservationsRepository;
  idempotency: IdempotencyRepository;
  payments: PaymentsRepository;
  settings: SettingsService;
}

/** Where the order is delivered (snapshot values). */
interface DeliveryTarget {
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  zone: DeliveryZoneRow;
  feeMinor: number;
}

interface PreparedLine {
  row: CartLineRow;
  item: NewOrderItem;
}

function toZoneDto(zone: DeliveryZoneRow, feeMinor: number): CustomerDeliveryZoneDto {
  return {
    id: zone.id,
    code: zone.code,
    name: zone.name,
    feeMinor,
    estDaysMin: zone.estDaysMin,
    estDaysMax: zone.estDaysMax,
  };
}

/** JSON with sorted keys, so the same payload always hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(input: CheckoutRequest): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** Same comparator everywhere stock rows are locked (checkout + release), so no deadlocks. */
function byVariantId(a: { variantId: string }, b: { variantId: string }): number {
  return a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0;
}

/** Readable fitting record kept on the order line (never recalculated later). */
function fitSnapshotOf(row: CartLineRow): unknown {
  if (row.decisionId === null) return null;
  return {
    decisionId: row.decisionId,
    method: row.decisionMethod,
    selectionMode: row.decisionSelectionMode,
    fitPreference: row.decisionFitPreference,
    recommendedSize: row.decisionRecommendedLabel,
    selectedSize: row.decisionSelectedLabel,
    charts: row.decisionChartSnapshot,
  };
}

/** What makes two checkouts "the same order": lines, prices, delivery and contact. */
function orderSignature(
  lines: readonly {
    variantId: string;
    quantity: number;
    blueprintDecisionId: string | null;
    unitPriceMinor: number;
  }[],
  delivery: Omit<DeliveryTarget, 'zone'> & { zoneId: string | null },
  contact: { email: string; phone: string },
): string {
  const sortedLines = [...lines]
    .sort(byVariantId)
    .map((l) => [l.variantId, l.quantity, l.blueprintDecisionId, l.unitPriceMinor]);
  return canonicalJson({ lines: sortedLines, delivery, contact });
}

function signatureOfOrder(order: OrderRow, items: readonly OrderItemRow[]): string {
  return orderSignature(
    items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      blueprintDecisionId: item.blueprintDecisionId,
      unitPriceMinor: int8ToNumber(item.unitPriceMinor),
    })),
    {
      recipientName: order.recipientName,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      city: order.city,
      state: order.state,
      landmark: order.landmark,
      feeMinor: int8ToNumber(order.deliveryFeeMinor),
      zoneId: order.deliveryZoneId,
    },
    { email: order.contactEmail, phone: order.contactPhone },
  );
}

function isTriggerRejection(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === RAISE_EXCEPTION;
}

export function createCheckoutService(deps: CheckoutServiceDeps): CheckoutService {
  const { db, logger, carts, orders, reservations, settings } = deps;

  /** Active zone with a fee, or a friendly error. */
  async function orderableZone(
    executor: Database,
    zoneId: string,
  ): Promise<{ zone: DeliveryZoneRow; feeMinor: number }> {
    const zone = await deps.zones.findById(executor, zoneId);
    const unavailable = () =>
      new AppError(
        'INVALID_DELIVERY_ZONE',
        HTTP_STATUS.BAD_REQUEST,
        'Choose an available delivery area.',
      );
    if (!zone) throw unavailable();
    // Checked before is_active: the DB only allows an active zone with a fee, so a zone that is
    // not priced yet (pending client data) is always inactive and gets the more precise code.
    if (zone.feeMinor === null) {
      throw new AppError(
        'DELIVERY_FEE_NOT_CONFIGURED',
        HTTP_STATUS.CONFLICT,
        'Delivery to this area is not priced yet. Choose another area.',
      );
    }
    if (!zone.isActive) throw unavailable();
    return { zone, feeMinor: int8ToNumber(zone.feeMinor) };
  }

  async function savedAddressZone(
    executor: Database,
    customerId: string,
    addressId: string | undefined,
  ) {
    if (addressId === undefined) throw notFoundError('Address');
    const address = await deps.addressRows.findOwned(executor, addressId, customerId);
    if (!address) throw notFoundError('Address');
    return address;
  }

  async function deliveryTarget(
    trx: Database,
    customerId: string,
    input: CheckoutRequest,
  ): Promise<DeliveryTarget> {
    let addressId = input.addressId;
    if (input.address !== undefined) {
      // A new address is saved to the account (same transaction: rolled back on failure).
      addressId = (
        await deps.addresses.create(customerId, { ...input.address, isDefault: false }, trx)
      ).id;
    }
    // The schema guarantees exactly one of addressId / address.
    const address = await savedAddressZone(trx, customerId, addressId);
    const { zone, feeMinor } = await orderableZone(trx, address.deliveryZoneId);
    return {
      recipientName: address.recipientName,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      landmark: address.landmark,
      zone,
      feeMinor,
    };
  }

  /** Re-checks every line against the database now; returns the order line snapshots. */
  async function prepareLines(
    trx: Database,
    customerId: string,
    cartId: string,
    currency: string,
  ): Promise<PreparedLine[]> {
    const rows = await carts.lines(trx, cartId);
    if (rows.length === 0)
      throw new AppError('CART_EMPTY', HTTP_STATUS.CONFLICT, 'Your bag is empty.');
    const max = await settings.getLimit(trx, 'cart.max_quantity_per_item');
    for (const row of rows) {
      const problem = decisionProblem(row, customerId);
      if (problem === 'missing') {
        throw new AppError(
          'BLUEPRINT_DECISION_REQUIRED',
          HTTP_STATUS.CONFLICT,
          'Use Find My Size for every item first.',
          {
            lineId: row.id,
          },
        );
      }
      if (isUnavailable(row, customerId, currency)) {
        throw new AppError(
          'PRODUCT_UNAVAILABLE',
          HTTP_STATUS.CONFLICT,
          `${row.productName} is no longer available.`,
          {
            lineId: row.id,
          },
        );
      }
      if (row.quantity > max) {
        throw new AppError(
          'QUANTITY_LIMIT_EXCEEDED',
          HTTP_STATUS.CONFLICT,
          `You can buy up to ${max} of an item.`,
          {
            lineId: row.id,
            maxQuantity: max,
          },
        );
      }
    }
    return rows.map((row) => ({
      row,
      item: {
        productId: row.productId,
        variantId: row.variantId,
        productName: row.productName,
        clothingTypeName: row.clothingTypeName ?? '',
        sizeLabel: row.sizeLabel,
        sku: row.sku,
        unitPriceMinor: int8ToNumber(row.priceMinor),
        quantity: row.quantity,
        blueprintDecisionId: row.decisionId,
        fitSnapshot: fitSnapshotOf(row),
      },
    }));
  }

  /** One conditional UPDATE per variant, in variant-id order. Any shortfall aborts everything. */
  async function reserveAll(trx: Database, lines: readonly PreparedLine[]): Promise<void> {
    for (const { row, item } of [...lines].sort((a, b) => byVariantId(a.item, b.item))) {
      if (!(await reservations.reserve(trx, item.variantId, item.quantity))) {
        throw new AppError(
          'INSUFFICIENT_STOCK',
          HTTP_STATUS.CONFLICT,
          `Not enough stock for ${row.productName} (${row.sizeLabel}).`,
          {
            lineId: row.id,
          },
        );
      }
    }
  }

  async function loadOrder(executor: Database, orderId: string): Promise<OrderDto> {
    const row = await orders.findById(executor, orderId);
    if (!row) throw notFoundError('Order');
    const [items, latest] = await Promise.all([
      orders.items(executor, [row.id]),
      deps.payments.latestForOrders(executor, [row.id]),
    ]);
    return toOrderDto(row, items, latest.get(row.id));
  }

  /**
   * One open (pending, unpaid) order per customer cart. Unchanged and still held: extend the hold
   * (capped by reservation_max_total_minutes from placement) and return it. Otherwise release its
   * stock and cancel it so a fresh order can be created. Returns the order id to reuse, if any.
   */
  async function settleOpenOrder(
    trx: Database,
    customerId: string,
    signature: string,
    now: Date,
  ): Promise<string | null> {
    const open = await orders.findOpenForUpdate(trx, customerId);
    if (!open) return null;
    const [holdMinutes, maxTotalMinutes, items] = await Promise.all([
      settings.getLimit(trx, 'checkout.reservation_minutes'),
      settings.getSetting(trx, 'checkout.reservation_max_total_minutes'),
      orders.items(trx, [open.id]),
    ]);
    const stillHeld = open.reservationExpiresAt !== null && open.reservationExpiresAt > now;
    const extended = new Date(
      Math.min(
        now.getTime() + holdMinutes * MS_PER_MINUTE,
        open.placedAt.getTime() + maxTotalMinutes * MS_PER_MINUTE,
      ),
    );
    if (stillHeld && extended > now && signatureOfOrder(open, items) === signature) {
      if (open.reservationExpiresAt === null || extended > open.reservationExpiresAt) {
        await orders.setReservationExpiry(trx, open.id, extended);
        await reservations.extend(trx, open.id, extended);
      }
      return open.id;
    }
    const reason = stillHeld ? CANCEL_REASONS.SUPERSEDED : CANCEL_REASONS.EXPIRED;
    await releaseOrderHolds(trx, reservations, open.id, reason);
    if (await orders.cancelPending(trx, open.id, reason)) {
      await orders.logStatus(trx, open.id, PENDING_PAYMENT, CANCELLED, reason);
    }
    logger.info({ orderId: open.id, reason }, 'checkout: open order cancelled');
    return null;
  }

  async function placeOrder(
    trx: Database,
    customerId: string,
    key: string,
    input: CheckoutRequest,
  ): Promise<CheckoutResult> {
    // Lock order: cart -> open order -> reservations -> variants (sorted). Expiry uses the same.
    const cartId = await carts.activeCartId(trx, customerId, true);
    const currency = await settings.getSetting(trx, 'store.currency');
    const lines = await prepareLines(trx, customerId, cartId, currency);
    const target = await deliveryTarget(trx, customerId, input);
    const { zone, ...delivery } = target;
    const contact = { email: input.contactEmail, phone: input.contactPhone };
    const signature = orderSignature(
      lines.map((l) => l.item),
      { ...delivery, zoneId: zone.id },
      contact,
    );
    const now = new Date();
    const reusedId = await settleOpenOrder(trx, customerId, signature, now);
    if (reusedId !== null) return { order: await loadOrder(trx, reusedId), created: false };

    await reserveAll(trx, lines);
    const holdMinutes = await settings.getLimit(trx, 'checkout.reservation_minutes');
    const expiresAt = new Date(now.getTime() + holdMinutes * MS_PER_MINUTE);
    const subtotalMinor = lines.reduce(
      (sum, l) => sum + l.item.unitPriceMinor * l.item.quantity,
      0,
    );
    const order = await orders.insert(trx, {
      customerId,
      sourceClient: input.client,
      idempotencyKey: key,
      currency,
      subtotalMinor,
      deliveryFeeMinor: target.feeMinor,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      recipientName: target.recipientName,
      addressLine1: target.addressLine1,
      addressLine2: target.addressLine2,
      city: target.city,
      state: target.state,
      landmark: target.landmark,
      deliveryZoneId: zone.id,
      deliveryZoneName: zone.name,
      languageCode: await orders.resolveLanguage(trx, customerId, input.language),
      reservationExpiresAt: expiresAt,
    });
    await orders.insertItems(
      trx,
      order.id,
      lines.map((l) => l.item),
    );
    const held = lines.map((l) => ({ variantId: l.item.variantId, quantity: l.item.quantity }));
    await reservations.insertHeld(trx, order.id, held, expiresAt);
    for (const hold of held) {
      await reservations.logMovement(trx, {
        ...hold,
        type: 'reservation',
        orderId: order.id,
        note: 'checkout',
      });
    }
    await orders.logStatus(trx, order.id, null, PENDING_PAYMENT, 'checkout');
    // The cart stays active: it is converted only when payment succeeds (Phase 6).
    logger.info(
      { orderId: order.id, orderNumber: order.orderNumber, lines: lines.length },
      'checkout: order created',
    );
    return { order: await loadOrder(trx, order.id), created: true };
  }

  return {
    async zones() {
      const rows = await deps.zones.listOrderable(db);
      return rows.flatMap((zone) =>
        zone.feeMinor === null ? [] : [toZoneDto(zone, int8ToNumber(zone.feeMinor))],
      );
    },

    async quote(customerId, input) {
      // The schema guarantees exactly one of zoneId / addressId.
      const zoneId =
        input.zoneId ?? (await savedAddressZone(db, customerId, input.addressId)).deliveryZoneId;
      const { zone, feeMinor } = await orderableZone(db, zoneId);
      const cart = await deps.cart.get(customerId);
      return {
        currency: cart.currency,
        subtotalMinor: cart.subtotalMinor,
        deliveryFeeMinor: feeMinor,
        totalMinor: cart.subtotalMinor + feeMinor,
        zone: toZoneDto(zone, feeMinor),
        canCheckout: cart.canCheckout,
      };
    },

    async createOrder(customerId, key, input) {
      const requestHash = hashRequest(input);
      try {
        return await db.transaction().execute(async (trx) => {
          // A concurrent request with the same key waits here until the first one commits.
          const claim = await deps.idempotency.claim(trx, {
            scope: IDEMPOTENCY_SCOPE,
            key,
            subjectId: customerId,
            requestHash,
          });
          if (!claim.created) {
            if (claim.record.requestHash !== requestHash) {
              throw new AppError(
                'IDEMPOTENCY_KEY_REUSED',
                HTTP_STATUS.CONFLICT,
                'This Idempotency-Key was already used for a different checkout.',
              );
            }
            const stored = claim.record.responseBody as { orderId?: unknown } | null;
            if (typeof stored?.orderId !== 'string') {
              throw new AppError(
                'DUPLICATE_REQUEST',
                HTTP_STATUS.CONFLICT,
                'This checkout is still being processed.',
              );
            }
            return { order: await loadOrder(trx, stored.orderId), created: false };
          }
          const result = await placeOrder(trx, customerId, key, input);
          await deps.idempotency.complete(trx, {
            scope: IDEMPOTENCY_SCOPE,
            key,
            subjectId: customerId,
            status: result.created ? HTTP_STATUS.CREATED : HTTP_STATUS.OK,
            body: { orderId: result.order.id },
          });
          return result;
        });
      } catch (err) {
        // Everything (idempotency row, reservations, saved address) rolled back; cart untouched.
        if (isTriggerRejection(err)) {
          throw new AppError(
            'BLUEPRINT_DECISION_INVALID',
            HTTP_STATUS.CONFLICT,
            'A fitting decision no longer matches an item.',
          );
        }
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) {
          throw new AppError(
            'DUPLICATE_REQUEST',
            HTTP_STATUS.CONFLICT,
            'This checkout was already submitted.',
          );
        }
        throw err;
      }
    },
  };
}
