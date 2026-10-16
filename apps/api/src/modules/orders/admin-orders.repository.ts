import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Database } from '../../db/database.js';
import type { Customers, DB, Orders } from '../../db/types.js';
import { escapeLike } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

const PAYMENT_REVIEW = 'payment_review';

export interface AdminOrderFilters {
  orderStatus?: string | undefined;
  paymentStatus?: string | undefined;
  from?: Date | undefined;
  /** Exclusive upper bound. */
  toExclusive?: Date | undefined;
  deliveryZoneId?: string | undefined;
  needsAttention?: boolean | undefined;
  q?: string | undefined;
  sort: 'placedAt' | 'total';
  order: 'asc' | 'desc';
}

export interface AdminOrderSummaryRow {
  id: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  recipientName: string;
  contactPhone: string;
  deliveryZoneName: string;
  currency: string;
  totalMinor: string;
  itemCount: number;
  placedAt: Date;
  paidAt: Date | null;
}

export interface AdminOrderDetailRow extends AdminOrderSummaryRow {
  sourceClient: string;
  languageCode: string;
  subtotalMinor: string;
  deliveryFeeMinor: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZoneId: string | null;
  carrier: string | null;
  trackingReference: string | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  reservationExpiresAt: Date | null;
}

export interface AdminOrderItemRow {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  clothingTypeName: string;
  sizeLabel: string;
  sku: string;
  quantity: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  blueprintDecisionId: string | null;
  fitSnapshot: unknown;
}

export interface MeasurementRow {
  decisionId: string;
  code: string;
  label: string;
  valueInches: string;
  requiredSize: string;
  sortOrder: number;
}

export interface AdminPaymentRow {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amountMinor: string;
  currency: string;
  channel: string | null;
  failureReason: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
  paidAt: Date | null;
}

export interface HistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  adminId: string | null;
  adminName: string | null;
  createdAt: Date;
}

export interface TransitionRow {
  fromStatus: string;
  toStatus: string;
  requiresPaid: boolean;
  requiresReason: boolean;
}

export interface StatusChange {
  orderId: string;
  expectedStatus: string;
  toStatus: string;
  carrier?: string | undefined;
  trackingReference?: string | undefined;
  markDelivered: boolean;
  cancelReason?: string | undefined;
}

type OrderListBuilder = ExpressionBuilder<DB & { o: Orders } & { c: Customers }, 'o' | 'c'>;

/** Same expressions as the trigram indexes in migration 0009 (so ILIKE uses them). */
const ORDER_SEARCH = sql<string>`(o.order_number || ' ' || o.contact_email::text || ' ' || o.contact_phone || ' ' || o.recipient_name)`;
const CUSTOMER_SEARCH = sql<string>`(c.full_name || ' ' || c.email::text || ' ' || coalesce(c.phone, ''))`;

function baseQuery(db: Database) {
  return db
    .selectFrom('orders as o')
    .innerJoin('customers as c', 'c.id', 'o.customer_id')
    .select([
      'o.id',
      'o.order_number as orderNumber',
      'o.order_status as orderStatus',
      'o.payment_status as paymentStatus',
      'c.id as customerId',
      'c.full_name as customerName',
      sql<string>`c.email::text`.as('customerEmail'),
      'o.recipient_name as recipientName',
      'o.contact_phone as contactPhone',
      'o.delivery_zone_name as deliveryZoneName',
      'o.currency',
      'o.total_minor as totalMinor',
      'o.placed_at as placedAt',
      'o.paid_at as paidAt',
    ])
    .select((eb) =>
      eb
        .selectFrom('order_items as i')
        .select(sql<number>`COALESCE(SUM(i.quantity), 0)::int`.as('n'))
        .whereRef('i.order_id', '=', 'o.id')
        .as('itemCount'),
    );
}

/** Admin reads and status writes on orders. Orders are never deleted. */
export interface AdminOrdersRepository {
  list(
    db: Database,
    filters: AdminOrderFilters,
    page: PageRequest,
  ): Promise<{ rows: AdminOrderSummaryRow[]; total: number }>;
  findDetail(db: Database, id: string): Promise<AdminOrderDetailRow | undefined>;
  items(db: Database, orderId: string): Promise<AdminOrderItemRow[]>;
  measurements(db: Database, decisionIds: readonly string[]): Promise<MeasurementRow[]>;
  payments(db: Database, orderId: string): Promise<AdminPaymentRow[]>;
  history(db: Database, orderId: string): Promise<HistoryRow[]>;
  transitionsFrom(db: Database, fromStatus: string): Promise<TransitionRow[]>;
  findTransition(
    db: Database,
    fromStatus: string,
    toStatus: string,
  ): Promise<TransitionRow | undefined>;
  /** Compare-and-set on order_status. false = the status changed meanwhile (nothing written). */
  applyStatusChange(db: Database, change: StatusChange): Promise<boolean>;
}

export function createAdminOrdersRepository(): AdminOrdersRepository {
  return {
    async list(db, filters, page) {
      const where = (eb: OrderListBuilder) => {
        const conditions: Expression<SqlBool>[] = [];
        if (filters.orderStatus !== undefined)
          conditions.push(eb('o.order_status', '=', filters.orderStatus));
        if (filters.paymentStatus !== undefined)
          conditions.push(eb('o.payment_status', '=', filters.paymentStatus));
        if (filters.from !== undefined) conditions.push(eb('o.placed_at', '>=', filters.from));
        if (filters.toExclusive !== undefined)
          conditions.push(eb('o.placed_at', '<', filters.toExclusive));
        if (filters.deliveryZoneId !== undefined)
          conditions.push(eb('o.delivery_zone_id', '=', filters.deliveryZoneId));
        if (filters.needsAttention === true)
          conditions.push(eb('o.order_status', '=', PAYMENT_REVIEW));
        if (filters.needsAttention === false)
          conditions.push(eb('o.order_status', '<>', PAYMENT_REVIEW));
        if (filters.q !== undefined) {
          const pattern = `%${escapeLike(filters.q)}%`;
          conditions.push(
            eb.or([eb(ORDER_SEARCH, 'ilike', pattern), eb(CUSTOMER_SEARCH, 'ilike', pattern)]),
          );
        }
        return eb.and(conditions);
      };
      const sortColumn = filters.sort === 'total' ? 'o.total_minor' : 'o.placed_at';
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .where(where)
          .orderBy(sortColumn, filters.order)
          .orderBy('o.id', filters.order)
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('orders as o')
          .innerJoin('customers as c', 'c.id', 'o.customer_id')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where(where)
          .executeTakeFirstOrThrow(),
      ]);
      return {
        rows: rows.map((row) => ({ ...row, itemCount: row.itemCount ?? 0 })),
        total: Number(count.total),
      };
    },

    async findDetail(db, id) {
      const row = await baseQuery(db)
        .select([
          'o.source_client as sourceClient',
          'o.language_code as languageCode',
          'o.subtotal_minor as subtotalMinor',
          'o.delivery_fee_minor as deliveryFeeMinor',
          sql<string>`o.contact_email::text`.as('contactEmail'),
          'o.ship_address_line1 as addressLine1',
          'o.ship_address_line2 as addressLine2',
          'o.ship_city as city',
          'o.ship_state as state',
          'o.ship_landmark as landmark',
          'o.delivery_zone_id as deliveryZoneId',
          'o.carrier',
          'o.tracking_reference as trackingReference',
          'o.delivered_at as deliveredAt',
          'o.cancelled_at as cancelledAt',
          'o.cancel_reason as cancelReason',
          'o.reservation_expires_at as reservationExpiresAt',
        ])
        .where('o.id', '=', id)
        .executeTakeFirst();
      return row ? { ...row, itemCount: row.itemCount ?? 0 } : undefined;
    },

    async items(db, orderId) {
      return db
        .selectFrom('order_items')
        .select([
          'id',
          'product_id as productId',
          'variant_id as variantId',
          'product_name as productName',
          'clothing_type_name as clothingTypeName',
          'size_label as sizeLabel',
          'sku',
          'quantity',
          'unit_price_minor as unitPriceMinor',
          'line_total_minor as lineTotalMinor',
          'blueprint_decision_id as blueprintDecisionId',
          'fit_snapshot as fitSnapshot',
        ])
        .where('order_id', '=', orderId)
        .orderBy('id')
        .execute();
    },

    async measurements(db, decisionIds) {
      if (decisionIds.length === 0) return [];
      return db
        .selectFrom('blueprint_measurements as m')
        .innerJoin('measurement_types as t', 't.id', 'm.measurement_type_id')
        .innerJoin('sizes as s', 's.id', 'm.required_size_id')
        .select([
          'm.decision_id as decisionId',
          't.code',
          't.label',
          sql<string>`m.value_inches::text`.as('valueInches'),
          's.label as requiredSize',
          't.sort_order as sortOrder',
        ])
        .where('m.decision_id', 'in', [...decisionIds])
        .orderBy('t.sort_order')
        .orderBy('t.code')
        .execute();
    },

    async payments(db, orderId) {
      // Never selects raw_verify_payload / gateway_response.
      return db
        .selectFrom('payments')
        .select([
          'id',
          'reference',
          'provider',
          'status',
          'amount_minor as amountMinor',
          'currency',
          'channel',
          'failure_reason as failureReason',
          'created_at as createdAt',
          'verified_at as verifiedAt',
          'paid_at as paidAt',
        ])
        .where('order_id', '=', orderId)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    },

    async history(db, orderId) {
      const rows = await db
        .selectFrom('order_status_history as h')
        .leftJoin('admin_users as a', 'a.id', 'h.changed_by_admin')
        .select([
          sql<string>`h.id::text`.as('id'),
          'h.from_status as fromStatus',
          'h.to_status as toStatus',
          'h.note',
          'h.changed_by_admin as adminId',
          'a.display_name as adminName',
          'h.created_at as createdAt',
        ])
        .where('h.order_id', '=', orderId)
        .orderBy('h.id')
        .execute();
      return rows;
    },

    async transitionsFrom(db, fromStatus) {
      return db
        .selectFrom('order_status_transitions as t')
        .innerJoin('order_statuses as s', 's.code', 't.to_status')
        .select([
          't.from_status as fromStatus',
          't.to_status as toStatus',
          't.requires_paid as requiresPaid',
          't.requires_reason as requiresReason',
        ])
        .where('t.from_status', '=', fromStatus)
        .where('t.is_active', '=', true)
        .orderBy('s.sort_order')
        .execute();
    },

    async findTransition(db, fromStatus, toStatus) {
      return db
        .selectFrom('order_status_transitions')
        .select([
          'from_status as fromStatus',
          'to_status as toStatus',
          'requires_paid as requiresPaid',
          'requires_reason as requiresReason',
        ])
        .where('from_status', '=', fromStatus)
        .where('to_status', '=', toStatus)
        .where('is_active', '=', true)
        .executeTakeFirst();
    },

    async applyStatusChange(db, change) {
      const result = await db
        .updateTable('orders')
        .set({
          order_status: change.toStatus,
          ...(change.carrier !== undefined && { carrier: change.carrier }),
          ...(change.trackingReference !== undefined && {
            tracking_reference: change.trackingReference,
          }),
          ...(change.markDelivered && { delivered_at: sql<Date>`now()` }),
          ...(change.cancelReason !== undefined && {
            cancelled_at: sql<Date>`now()`,
            cancel_reason: change.cancelReason,
            reservation_expires_at: null,
          }),
        })
        .where('id', '=', change.orderId)
        .where('order_status', '=', change.expectedStatus)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },
  };
}
