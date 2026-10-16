import {
  sql,
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  type Updateable,
} from 'kysely';
import type { Database } from '../../db/database.js';
import type { DB, ReturnRequests } from '../../db/types.js';
import { escapeLike } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

const CLOSED_STATUSES = ['COMPLETED', 'REJECTED', 'CANCELLED'];
/** Requests that count against the purchased quantity. */
const NOT_COUNTED = ['REJECTED', 'CANCELLED'];

export interface OrderItemForReturn {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  deliveredAt: Date | null;
  contactEmail: string;
  languageCode: string;
  recipientName: string;
  itemId: string;
  productId: string;
  variantId: string;
  quantity: number;
  productName: string;
  sizeLabel: string;
  blueprintDecisionId: string | null;
  selectionMode: string | null;
}

export interface EvidenceAssetRow {
  id: string;
  ownerCustomerId: string | null;
  visibility: string;
  status: string;
  retiredAt: Date | null;
  attached: boolean;
}

export interface ReturnRow {
  id: string;
  requestNumber: string;
  orderId: string;
  orderItemId: string;
  customerId: string;
  requestType: string;
  reasonCode: string;
  explanation: string | null;
  quantity: number;
  exchangeSizeId: string | null;
  exchangeSizeLabel: string | null;
  blueprintDecisionId: string | null;
  policyId: string | null;
  status: string;
  statusLabel: string;
  responsibility: string;
  responsibilitySetBy: string;
  faultBasis: string | null;
  responsibilitySetAt: Date | null;
  faultCause: string | null;
  payer: string;
  adminDecision: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  replacementVariantId: string | null;
  replacementSku: string | null;
  replacementCarrier: string | null;
  replacementTrackingReference: string | null;
  replacementSentAt: Date | null;
  inspectionOutcome: string | null;
  inspectedAt: Date | null;
  inspectedBy: string | null;
  inspectedByName: string | null;
  inspectionNotes: string | null;
  confirmedOriginalTags: boolean | null;
  confirmedUnwornUnwashed: boolean | null;
  submittedAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
  // order / item / customer context
  orderNumber: string;
  orderStatus: string;
  orderPaymentStatus: string;
  orderCurrency: string;
  deliveredAt: Date | null;
  contactEmail: string;
  languageCode: string;
  recipientName: string;
  productId: string;
  variantId: string;
  productName: string;
  sku: string;
  sizeLabel: string;
  purchasedQuantity: number;
  unitPriceMinor: string;
  customerName: string;
  customerEmail: string;
}

export interface ReturnEventRow {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  actorId: string | null;
  actorName: string | null;
  note: string | null;
  visibility: 'CUSTOMER' | 'INTERNAL';
  createdAt: Date;
}

export interface DecisionRow {
  id: string;
  method: string;
  selectionMode: string;
  fitPreference: string;
  recommendedSize: string;
  selectedSize: string;
  chartSnapshot: unknown;
}

export interface ReturnTransitionRow {
  fromStatus: string;
  toStatus: string;
  requestType: string | null;
  requiresReason: boolean;
  requiresInspection: boolean;
}

export interface PolicyRow {
  id: string;
  version: number;
  name: string;
  requestWindowDays: number | null;
  requireOriginalTags: boolean | null;
  requireUnwornUnwashed: boolean | null;
}

export interface NewReturnRequest {
  orderId: string;
  orderItemId: string;
  customerId: string;
  requestType: string;
  reasonCode: string;
  explanation: string | null;
  quantity: number;
  exchangeSizeId: string | null;
  replacementVariantId: string | null;
  policyId: string | null;
  responsibility: string;
  faultCause: string | null;
  payer: string;
  faultBasis: string;
  confirmedOriginalTags: boolean | null;
  confirmedUnwornUnwashed: boolean | null;
}

export interface NewReturnEvent {
  returnRequestId: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  actorId: string | null;
  note: string | null;
  visibility: 'CUSTOMER' | 'INTERNAL';
}

export interface AdminReturnFilters {
  status?: string | undefined;
  requestType?: string | undefined;
  responsibility?: string | undefined;
  reasonCode?: string | undefined;
  from?: Date | undefined;
  toExclusive?: Date | undefined;
  q?: string | undefined;
  open?: boolean | undefined;
  order: 'asc' | 'desc';
}

type ReturnListBuilder = ExpressionBuilder<
  DB & { rr: ReturnRequests } & { o: DB['orders'] } & { c: DB['customers'] },
  'rr' | 'o' | 'c'
>;

const ORDER_SEARCH = sql<string>`(o.order_number || ' ' || o.contact_email::text || ' ' || o.contact_phone || ' ' || o.recipient_name)`;
const CUSTOMER_SEARCH = sql<string>`(c.full_name || ' ' || c.email::text || ' ' || coalesce(c.phone, ''))`;

function baseQuery(db: Database) {
  return db
    .selectFrom('return_requests as rr')
    .innerJoin('orders as o', 'o.id', 'rr.order_id')
    .innerJoin('order_items as oi', 'oi.id', 'rr.order_item_id')
    .innerJoin('customers as c', 'c.id', 'rr.customer_id')
    .innerJoin('return_statuses as st', 'st.code', 'rr.status')
    .leftJoin('sizes as xs', 'xs.id', 'rr.exchange_size_id')
    .leftJoin('product_variants as rv', 'rv.id', 'rr.replacement_variant_id')
    .leftJoin('admin_users as ra', 'ra.id', 'rr.reviewed_by')
    .leftJoin('admin_users as ia', 'ia.id', 'rr.inspected_by')
    .select([
      'rr.id',
      'rr.request_number as requestNumber',
      'rr.order_id as orderId',
      'rr.order_item_id as orderItemId',
      'rr.customer_id as customerId',
      'rr.request_type as requestType',
      'rr.reason_code as reasonCode',
      'rr.customer_explanation as explanation',
      'rr.quantity',
      'rr.exchange_size_id as exchangeSizeId',
      'xs.label as exchangeSizeLabel',
      'rr.blueprint_decision_id as blueprintDecisionId',
      'rr.policy_id as policyId',
      'rr.status',
      'st.label as statusLabel',
      'rr.responsibility',
      'rr.responsibility_set_by as responsibilitySetBy',
      'rr.fault_basis as faultBasis',
      'rr.responsibility_set_at as responsibilitySetAt',
      'rr.fault_cause as faultCause',
      'rr.reverse_logistics_payer as payer',
      'rr.admin_decision as adminDecision',
      'rr.reviewed_by as reviewedBy',
      'ra.display_name as reviewedByName',
      'rr.reviewed_at as reviewedAt',
      'rr.replacement_variant_id as replacementVariantId',
      'rv.sku as replacementSku',
      'rr.replacement_carrier as replacementCarrier',
      'rr.replacement_tracking_reference as replacementTrackingReference',
      'rr.replacement_sent_at as replacementSentAt',
      'rr.inspection_outcome as inspectionOutcome',
      'rr.inspected_at as inspectedAt',
      'rr.inspected_by as inspectedBy',
      'ia.display_name as inspectedByName',
      'rr.inspection_notes as inspectionNotes',
      'rr.confirmed_original_tags as confirmedOriginalTags',
      'rr.confirmed_unworn_unwashed as confirmedUnwornUnwashed',
      'rr.submitted_at as submittedAt',
      'rr.closed_at as closedAt',
      'rr.updated_at as updatedAt',
      'o.order_number as orderNumber',
      'o.order_status as orderStatus',
      'o.payment_status as orderPaymentStatus',
      'o.currency as orderCurrency',
      'o.delivered_at as deliveredAt',
      sql<string>`o.contact_email::text`.as('contactEmail'),
      'o.language_code as languageCode',
      'o.recipient_name as recipientName',
      'oi.product_id as productId',
      'oi.variant_id as variantId',
      'oi.product_name as productName',
      'oi.sku',
      'oi.size_label as sizeLabel',
      'oi.quantity as purchasedQuantity',
      'oi.unit_price_minor as unitPriceMinor',
      'c.full_name as customerName',
      sql<string>`c.email::text`.as('customerEmail'),
    ]);
}

export interface ReturnsRepository {
  /** The customer's order item, locked (serialises concurrent requests for one item). */
  lockOrderItem(
    db: Database,
    orderId: string,
    itemId: string,
    customerId: string,
  ): Promise<OrderItemForReturn | undefined>;
  countedQuantity(db: Database, orderItemId: string): Promise<number>;
  hasOpenRequest(db: Database, orderItemId: string): Promise<boolean>;
  decision(db: Database, decisionId: string): Promise<DecisionRow | undefined>;
  reason(
    db: Database,
    code: string,
  ): Promise<{ code: string; evidenceRequirement: string } | undefined>;
  activePolicy(db: Database): Promise<PolicyRow | undefined>;
  policy(db: Database, id: string): Promise<PolicyRow | undefined>;
  variantForSize(
    db: Database,
    productId: string,
    sizeId: string,
  ): Promise<{ id: string; isActive: boolean } | undefined>;
  evidenceAssets(db: Database, ids: readonly string[]): Promise<EvidenceAssetRow[]>;
  insert(db: Database, request: NewReturnRequest): Promise<string>;
  attachMedia(db: Database, returnRequestId: string, mediaIds: readonly string[]): Promise<void>;
  media(
    db: Database,
    returnRequestId: string,
  ): Promise<
    { id: string; mimeType: string; status: string; originalKey: string; purgedAt: Date | null }[]
  >;
  insertEvent(db: Database, event: NewReturnEvent): Promise<string>;
  events(db: Database, returnRequestId: string, visibility?: 'CUSTOMER'): Promise<ReturnEventRow[]>;
  find(db: Database, id: string, lock?: boolean): Promise<ReturnRow | undefined>;
  findForCustomer(db: Database, id: string, customerId: string): Promise<ReturnRow | undefined>;
  listForCustomer(
    db: Database,
    customerId: string,
    page: PageRequest,
  ): Promise<{ rows: ReturnRow[]; total: number }>;
  listAdmin(
    db: Database,
    filters: AdminReturnFilters,
    page: PageRequest,
  ): Promise<{ rows: ReturnRow[]; total: number }>;
  /** Compare-and-set on status; false = the status changed meanwhile. */
  update(
    db: Database,
    id: string,
    expectedStatus: string,
    values: Updateable<ReturnRequests>,
  ): Promise<boolean>;
  findTransition(
    db: Database,
    from: string,
    to: string,
    actor: 'ADMIN' | 'CUSTOMER',
  ): Promise<ReturnTransitionRow | undefined>;
  transitionsFrom(
    db: Database,
    from: string,
    actor: 'ADMIN' | 'CUSTOMER',
    requestType: string,
  ): Promise<ReturnTransitionRow[]>;
  isTerminal(db: Database, status: string): Promise<boolean>;
}

export function createReturnsRepository(): ReturnsRepository {
  const transitionColumns = [
    'from_status as fromStatus',
    'to_status as toStatus',
    'request_type as requestType',
    'requires_reason as requiresReason',
    'requires_inspection as requiresInspection',
  ] as const;
  const policyColumns = [
    'id',
    'version',
    'name',
    'request_window_days as requestWindowDays',
    'require_original_tags as requireOriginalTags',
    'require_unworn_unwashed as requireUnwornUnwashed',
  ] as const;

  return {
    async lockOrderItem(db, orderId, itemId, customerId) {
      const result = await sql<OrderItemForReturn>`
        SELECT o.id AS "orderId", o.order_number AS "orderNumber", o.order_status AS "orderStatus",
               o.payment_status AS "paymentStatus", o.delivered_at AS "deliveredAt",
               o.contact_email::text AS "contactEmail", o.language_code AS "languageCode",
               o.recipient_name AS "recipientName",
               oi.id AS "itemId", oi.product_id AS "productId", oi.variant_id AS "variantId",
               oi.quantity, oi.product_name AS "productName", oi.size_label AS "sizeLabel",
               oi.blueprint_decision_id AS "blueprintDecisionId", d.selection_mode AS "selectionMode"
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN blueprint_decisions d ON d.id = oi.blueprint_decision_id
        WHERE oi.id = ${itemId} AND oi.order_id = ${orderId} AND o.customer_id = ${customerId}
        FOR UPDATE OF oi`.execute(db);
      return result.rows[0];
    },

    async countedQuantity(db, orderItemId) {
      const row = await db
        .selectFrom('return_requests')
        .select(sql<number>`coalesce(sum(quantity), 0)::int`.as('n'))
        .where('order_item_id', '=', orderItemId)
        .where('status', 'not in', NOT_COUNTED)
        .executeTakeFirstOrThrow();
      return row.n;
    },

    async hasOpenRequest(db, orderItemId) {
      const row = await db
        .selectFrom('return_requests')
        .select('id')
        .where('order_item_id', '=', orderItemId)
        .where('status', 'not in', CLOSED_STATUSES)
        .executeTakeFirst();
      return row !== undefined;
    },

    async decision(db, decisionId) {
      return db
        .selectFrom('blueprint_decisions as d')
        .innerJoin('sizes as rs', 'rs.id', 'd.recommended_size_id')
        .innerJoin('sizes as ss', 'ss.id', 'd.selected_size_id')
        .select([
          'd.id',
          'd.measurement_method as method',
          'd.selection_mode as selectionMode',
          'd.fit_preference as fitPreference',
          'rs.label as recommendedSize',
          'ss.label as selectedSize',
          'd.chart_snapshot as chartSnapshot',
        ])
        .where('d.id', '=', decisionId)
        .executeTakeFirst();
    },

    async reason(db, code) {
      return db
        .selectFrom('return_reasons')
        .select(['code', 'evidence_requirement as evidenceRequirement'])
        .where('code', '=', code)
        .where('is_active', '=', true)
        .executeTakeFirst();
    },

    async activePolicy(db) {
      return db
        .selectFrom('return_policies')
        .select(policyColumns)
        .where('status', '=', 'active')
        .executeTakeFirst();
    },

    async policy(db, id) {
      return db
        .selectFrom('return_policies')
        .select(policyColumns)
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async variantForSize(db, productId, sizeId) {
      return db
        .selectFrom('product_variants')
        .select(['id', 'is_active as isActive'])
        .where('product_id', '=', productId)
        .where('size_id', '=', sizeId)
        .executeTakeFirst();
    },

    async evidenceAssets(db, ids) {
      if (ids.length === 0) return [];
      return db
        .selectFrom('media_assets as m')
        .select([
          'm.id',
          'm.owner_customer_id as ownerCustomerId',
          'm.visibility',
          'm.processing_status as status',
          'm.retired_at as retiredAt',
          sql<boolean>`EXISTS (SELECT 1 FROM return_request_media rm WHERE rm.media_asset_id = m.id)`.as(
            'attached',
          ),
        ])
        .where('m.id', 'in', [...ids])
        .execute();
    },

    async insert(db, request) {
      const row = await db
        .insertInto('return_requests')
        .values({
          order_id: request.orderId,
          order_item_id: request.orderItemId,
          customer_id: request.customerId,
          request_type: request.requestType,
          reason_code: request.reasonCode,
          customer_explanation: request.explanation,
          quantity: request.quantity,
          exchange_size_id: request.exchangeSizeId,
          replacement_variant_id: request.replacementVariantId,
          policy_id: request.policyId,
          responsibility: request.responsibility,
          responsibility_set_by: 'SYSTEM',
          fault_basis: request.faultBasis,
          fault_cause: request.faultCause,
          responsibility_set_at: sql<Date>`now()`,
          reverse_logistics_payer: request.payer,
          confirmed_original_tags: request.confirmedOriginalTags,
          confirmed_unworn_unwashed: request.confirmedUnwornUnwashed,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async attachMedia(db, returnRequestId, mediaIds) {
      if (mediaIds.length === 0) return;
      const start = await db
        .selectFrom('return_request_media')
        .select(sql<number>`coalesce(max(sort_order), -1)::int`.as('n'))
        .where('return_request_id', '=', returnRequestId)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('return_request_media')
        .values(
          mediaIds.map((id, i) => ({
            return_request_id: returnRequestId,
            media_asset_id: id,
            sort_order: start.n + 1 + i,
          })),
        )
        .execute();
    },

    async media(db, returnRequestId) {
      return db
        .selectFrom('return_request_media as rm')
        .innerJoin('media_assets as m', 'm.id', 'rm.media_asset_id')
        .select([
          'm.id',
          'm.mime_type as mimeType',
          'm.processing_status as status',
          'm.original_key as originalKey',
          'm.purged_at as purgedAt',
        ])
        .where('rm.return_request_id', '=', returnRequestId)
        .orderBy('rm.sort_order')
        .execute();
    },

    async insertEvent(db, event) {
      const row = await db
        .insertInto('return_request_events')
        .values({
          return_request_id: event.returnRequestId,
          event_type: event.type,
          from_status: event.fromStatus,
          to_status: event.toStatus,
          actor_type: event.actorType,
          actor_id: event.actorId,
          note: event.note,
          visibility: event.visibility,
        })
        .returning(sql<string>`id::text`.as('id'))
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async events(db, returnRequestId, visibility) {
      let query = db
        .selectFrom('return_request_events as e')
        .leftJoin('admin_users as a', (join) =>
          join.onRef('a.id', '=', 'e.actor_id').on('e.actor_type', '=', 'ADMIN'),
        )
        .select([
          sql<string>`e.id::text`.as('id'),
          'e.event_type as type',
          'e.from_status as fromStatus',
          'e.to_status as toStatus',
          sql<'CUSTOMER' | 'ADMIN' | 'SYSTEM'>`e.actor_type`.as('actorType'),
          'e.actor_id as actorId',
          'a.display_name as actorName',
          'e.note',
          sql<'CUSTOMER' | 'INTERNAL'>`e.visibility`.as('visibility'),
          'e.created_at as createdAt',
        ])
        .where('e.return_request_id', '=', returnRequestId);
      if (visibility !== undefined) query = query.where('e.visibility', '=', visibility);
      return query.orderBy('e.id').execute();
    },

    async find(db, id, lock = false) {
      if (lock) {
        // Lock the bare row first. Locking the joined query (FOR UPDATE OF rr) would make a
        // waiting transaction re-check the join against the OLD status row after a concurrent
        // status change and wrongly return nothing (a 404 instead of a conflict).
        const locked = await db
          .selectFrom('return_requests')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!locked) return undefined;
      }
      return baseQuery(db).where('rr.id', '=', id).executeTakeFirst();
    },

    async findForCustomer(db, id, customerId) {
      return baseQuery(db)
        .where('rr.id', '=', id)
        .where('rr.customer_id', '=', customerId)
        .executeTakeFirst();
    },

    async listForCustomer(db, customerId, page) {
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .where('rr.customer_id', '=', customerId)
          .orderBy('rr.submitted_at', 'desc')
          .orderBy('rr.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('return_requests')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where('customer_id', '=', customerId)
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async listAdmin(db, filters, page) {
      const where = (eb: ReturnListBuilder) => {
        const conditions: Expression<SqlBool>[] = [];
        if (filters.status !== undefined) conditions.push(eb('rr.status', '=', filters.status));
        if (filters.requestType !== undefined)
          conditions.push(eb('rr.request_type', '=', filters.requestType));
        if (filters.responsibility !== undefined)
          conditions.push(eb('rr.responsibility', '=', filters.responsibility));
        if (filters.reasonCode !== undefined)
          conditions.push(eb('rr.reason_code', '=', filters.reasonCode));
        if (filters.from !== undefined) conditions.push(eb('rr.submitted_at', '>=', filters.from));
        if (filters.toExclusive !== undefined)
          conditions.push(eb('rr.submitted_at', '<', filters.toExclusive));
        if (filters.open === true) conditions.push(eb('rr.status', 'not in', CLOSED_STATUSES));
        if (filters.open === false) conditions.push(eb('rr.status', 'in', CLOSED_STATUSES));
        if (filters.q !== undefined) {
          const pattern = `%${escapeLike(filters.q)}%`;
          conditions.push(
            eb.or([
              eb('rr.request_number', 'ilike', pattern),
              eb(ORDER_SEARCH, 'ilike', pattern),
              eb(CUSTOMER_SEARCH, 'ilike', pattern),
            ]),
          );
        }
        return eb.and(conditions);
      };
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .where(where)
          .orderBy('rr.submitted_at', filters.order)
          .orderBy('rr.id', filters.order)
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('return_requests as rr')
          .innerJoin('orders as o', 'o.id', 'rr.order_id')
          .innerJoin('customers as c', 'c.id', 'rr.customer_id')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where(where)
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async update(db, id, expectedStatus, values) {
      const result = await db
        .updateTable('return_requests')
        .set(values)
        .where('id', '=', id)
        .where('status', '=', expectedStatus)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 1;
    },

    async findTransition(db, from, to, actor) {
      return db
        .selectFrom('return_status_transitions')
        .select(transitionColumns)
        .where('from_status', '=', from)
        .where('to_status', '=', to)
        .where('actor', '=', actor)
        .where('is_active', '=', true)
        .executeTakeFirst();
    },

    async transitionsFrom(db, from, actor, requestType) {
      return db
        .selectFrom('return_status_transitions as t')
        .innerJoin('return_statuses as s', 's.code', 't.to_status')
        .select([
          't.from_status as fromStatus',
          't.to_status as toStatus',
          't.request_type as requestType',
          't.requires_reason as requiresReason',
          't.requires_inspection as requiresInspection',
        ])
        .where('t.from_status', '=', from)
        .where('t.actor', '=', actor)
        .where('t.is_active', '=', true)
        .where((eb) =>
          eb.or([eb('t.request_type', 'is', null), eb('t.request_type', '=', requestType)]),
        )
        .orderBy('s.sort_order')
        .execute();
    },

    async isTerminal(db, status) {
      const row = await db
        .selectFrom('return_statuses')
        .select('is_terminal')
        .where('code', '=', status)
        .executeTakeFirst();
      return row?.is_terminal === true;
    },
  };
}
