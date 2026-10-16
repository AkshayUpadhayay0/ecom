import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

const PENDING_PAYMENT = 'pending_payment';
const CANCELLED = 'cancelled';
const OPEN_PAYMENT_STATUSES = ['unpaid', 'failed'];

export interface NewOrder {
  customerId: string;
  sourceClient: string;
  idempotencyKey: string;
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  contactEmail: string;
  contactPhone: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZoneId: string;
  deliveryZoneName: string;
  languageCode: string;
  reservationExpiresAt: Date;
}

export interface NewOrderItem {
  productId: string;
  variantId: string;
  productName: string;
  clothingTypeName: string;
  sizeLabel: string;
  sku: string;
  unitPriceMinor: number;
  quantity: number;
  blueprintDecisionId: string | null;
  fitSnapshot: unknown;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  customerId: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  subtotalMinor: string;
  deliveryFeeMinor: string;
  totalMinor: string;
  contactEmail: string;
  contactPhone: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZoneId: string | null;
  deliveryZoneName: string;
  reservationExpiresAt: Date | null;
  cancelReason: string | null;
  placedAt: Date;
  paidAt: Date | null;
  languageCode: string;
}

export interface PaymentOutcomeChange {
  orderStatus?: string;
  paymentStatus?: string;
  /** Sets paid_at = now(). */
  markPaid?: boolean;
  /** A late payment revived a cancelled order: cancelled_at / cancel_reason cleared. */
  clearCancellation?: boolean;
  /** No stock hold any more (paid or under review). */
  clearReservation?: boolean;
  /** Cancels the order: cancelled_at = now(), cancel_reason = this. */
  cancelReason?: string;
}

export interface OrderItemRow {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  productName: string;
  sizeLabel: string;
  sku: string;
  unitPriceMinor: string;
  quantity: number;
  lineTotalMinor: string;
  blueprintDecisionId: string | null;
  fitSnapshot: unknown;
}

const ORDER_COLUMNS = [
  'id',
  'order_number as orderNumber',
  'customer_id as customerId',
  'order_status as orderStatus',
  'payment_status as paymentStatus',
  'currency',
  'subtotal_minor as subtotalMinor',
  'delivery_fee_minor as deliveryFeeMinor',
  'total_minor as totalMinor',
  'contact_email as contactEmail',
  'contact_phone as contactPhone',
  'recipient_name as recipientName',
  'ship_address_line1 as addressLine1',
  'ship_address_line2 as addressLine2',
  'ship_city as city',
  'ship_state as state',
  'ship_landmark as landmark',
  'delivery_zone_id as deliveryZoneId',
  'delivery_zone_name as deliveryZoneName',
  'reservation_expires_at as reservationExpiresAt',
  'cancel_reason as cancelReason',
  'placed_at as placedAt',
  'paid_at as paidAt',
  'language_code as languageCode',
] as const;

/** Orders are never deleted; status changes always write order_status_history. */
export interface OrdersRepository {
  insert(db: Database, order: NewOrder): Promise<OrderRow>;
  insertItems(db: Database, orderId: string, items: readonly NewOrderItem[]): Promise<void>;
  /** Status history row (changed_by_admin NULL = system / customer action). */
  logStatus(
    db: Database,
    orderId: string,
    from: string | null,
    to: string,
    note: string,
    /** The admin who made the change (omitted = system). */
    adminId?: string,
  ): Promise<void>;
  /** The customer's latest unpaid (or declined) pending order, locked (one open order per cart/customer). */
  findOpenForUpdate(db: Database, customerId: string): Promise<OrderRow | undefined>;
  findOwned(db: Database, id: string, customerId: string): Promise<OrderRow | undefined>;
  findById(db: Database, id: string): Promise<OrderRow | undefined>;
  items(db: Database, orderIds: readonly string[]): Promise<OrderItemRow[]>;
  /** pending_payment -> cancelled (only from pending_payment). Returns false if not pending. */
  cancelPending(db: Database, orderId: string, reason: string): Promise<boolean>;
  /** The order row, locked (payment confirmation). */
  lockById(db: Database, orderId: string): Promise<OrderRow | undefined>;
  /** Payment outcome on the order (statuses, paid_at, cancellation / hold cleared). */
  applyPaymentOutcome(db: Database, orderId: string, change: PaymentOutcomeChange): Promise<void>;
  setReservationExpiry(db: Database, orderId: string, expiresAt: Date): Promise<void>;
  listForCustomer(
    db: Database,
    customerId: string,
    page: PageRequest,
  ): Promise<{ rows: (OrderRow & { itemCount: number })[]; total: number }>;
  /** Requested language if active, else the customer's preferred one, else the default. */
  resolveLanguage(db: Database, customerId: string, requested: string | undefined): Promise<string>;
}

export function createOrdersRepository(): OrdersRepository {
  return {
    async insert(db, order) {
      return db
        .insertInto('orders')
        .values({
          customer_id: order.customerId,
          source_client: order.sourceClient,
          idempotency_key: order.idempotencyKey,
          currency: order.currency,
          subtotal_minor: order.subtotalMinor,
          delivery_fee_minor: order.deliveryFeeMinor,
          total_minor: order.subtotalMinor + order.deliveryFeeMinor,
          contact_email: order.contactEmail,
          contact_phone: order.contactPhone,
          recipient_name: order.recipientName,
          ship_address_line1: order.addressLine1,
          ship_address_line2: order.addressLine2,
          ship_city: order.city,
          ship_state: order.state,
          ship_landmark: order.landmark,
          delivery_zone_id: order.deliveryZoneId,
          delivery_zone_name: order.deliveryZoneName,
          language_code: order.languageCode,
          reservation_expires_at: order.reservationExpiresAt,
        })
        .returning(ORDER_COLUMNS)
        .executeTakeFirstOrThrow();
    },

    async insertItems(db, orderId, items) {
      if (items.length === 0) return;
      await db
        .insertInto('order_items')
        .values(
          items.map((item) => ({
            order_id: orderId,
            product_id: item.productId,
            variant_id: item.variantId,
            product_name: item.productName,
            clothing_type_name: item.clothingTypeName,
            size_label: item.sizeLabel,
            sku: item.sku,
            unit_price_minor: item.unitPriceMinor,
            quantity: item.quantity,
            line_total_minor: item.unitPriceMinor * item.quantity,
            blueprint_decision_id: item.blueprintDecisionId,
            fit_snapshot: item.fitSnapshot === null ? null : JSON.stringify(item.fitSnapshot),
          })),
        )
        .execute();
    },

    async logStatus(db, orderId, from, to, note, adminId) {
      await db
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          from_status: from,
          to_status: to,
          note,
          changed_by_admin: adminId ?? null,
        })
        .execute();
    },

    async findOpenForUpdate(db, customerId) {
      return (
        db
          .selectFrom('orders')
          .select(ORDER_COLUMNS)
          .where('customer_id', '=', customerId)
          .where('order_status', '=', PENDING_PAYMENT)
          // A declined payment leaves the order open for a retry (payment_status 'failed').
          .where('payment_status', 'in', OPEN_PAYMENT_STATUSES)
          .orderBy('placed_at', 'desc')
          .limit(1)
          .forUpdate()
          .executeTakeFirst()
      );
    },

    async findOwned(db, id, customerId) {
      return db
        .selectFrom('orders')
        .select(ORDER_COLUMNS)
        .where('id', '=', id)
        .where('customer_id', '=', customerId)
        .executeTakeFirst();
    },

    async findById(db, id) {
      return db.selectFrom('orders').select(ORDER_COLUMNS).where('id', '=', id).executeTakeFirst();
    },

    async items(db, orderIds) {
      if (orderIds.length === 0) return [];
      return db
        .selectFrom('order_items')
        .select([
          'id',
          'order_id as orderId',
          'product_id as productId',
          'variant_id as variantId',
          'product_name as productName',
          'size_label as sizeLabel',
          'sku',
          'unit_price_minor as unitPriceMinor',
          'quantity',
          'line_total_minor as lineTotalMinor',
          'blueprint_decision_id as blueprintDecisionId',
          'fit_snapshot as fitSnapshot',
        ])
        .where('order_id', 'in', [...orderIds])
        .orderBy('id')
        .execute();
    },

    async cancelPending(db, orderId, reason) {
      const result = await db
        .updateTable('orders')
        .set({
          order_status: CANCELLED,
          cancel_reason: reason,
          cancelled_at: sql`now()`,
          reservation_expires_at: null,
        })
        .where('id', '=', orderId)
        .where('order_status', '=', PENDING_PAYMENT)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) > 0;
    },

    async lockById(db, orderId) {
      return db
        .selectFrom('orders')
        .select(ORDER_COLUMNS)
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();
    },

    async applyPaymentOutcome(db, orderId, change) {
      await db
        .updateTable('orders')
        .set({
          ...(change.orderStatus !== undefined && { order_status: change.orderStatus }),
          ...(change.paymentStatus !== undefined && { payment_status: change.paymentStatus }),
          ...(change.markPaid === true && { paid_at: sql<Date>`now()` }),
          ...(change.clearCancellation === true && { cancelled_at: null, cancel_reason: null }),
          ...(change.clearReservation === true && { reservation_expires_at: null }),
          ...(change.cancelReason !== undefined && {
            cancelled_at: sql<Date>`now()`,
            cancel_reason: change.cancelReason,
          }),
        })
        .where('id', '=', orderId)
        .execute();
    },

    async setReservationExpiry(db, orderId, expiresAt) {
      await db
        .updateTable('orders')
        .set({ reservation_expires_at: expiresAt })
        .where('id', '=', orderId)
        .execute();
    },

    async listForCustomer(db, customerId, page) {
      const [rows, count] = await Promise.all([
        db
          .selectFrom('orders as o')
          .select(ORDER_COLUMNS.map((column) => `o.${column}` as const))
          .select((eb) =>
            eb
              .selectFrom('order_items as i')
              .select(sql<number>`COALESCE(SUM(i.quantity), 0)::int`.as('n'))
              .whereRef('i.order_id', '=', 'o.id')
              .as('itemCount'),
          )
          .where('o.customer_id', '=', customerId)
          .orderBy('o.placed_at', 'desc')
          .orderBy('o.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('orders')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where('customer_id', '=', customerId)
          .executeTakeFirstOrThrow(),
      ]);
      return {
        rows: rows.map((row) => ({ ...row, itemCount: row.itemCount ?? 0 })),
        total: Number(count.total),
      };
    },

    async resolveLanguage(db, customerId, requested) {
      const result = await sql<{ code: string }>`
        SELECT COALESCE(
          (SELECT code FROM languages WHERE code = ${requested ?? null} AND is_active),
          (SELECT l.code FROM customers c JOIN languages l ON l.code = c.preferred_language
            WHERE c.id = ${customerId} AND l.is_active),
          (SELECT code FROM languages WHERE is_default LIMIT 1)
        ) AS code`.execute(db);
      const code = result.rows[0]?.code;
      if (code === undefined) throw new Error('No default language configured');
      return code;
    },
  };
}
