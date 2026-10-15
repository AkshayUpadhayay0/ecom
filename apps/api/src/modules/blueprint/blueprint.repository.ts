import { sql } from 'kysely';
import type { MeasurementMethod, SelectionMode } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

const ACTIVE = 'active';

export interface FittingProductRow {
  id: string;
  slug: string;
  name: string;
  profileId: string | null;
  profileCode: string | null;
  profileName: string | null;
}

/** One profile item with its measurement and the ACTIVE chart of its group (if any). */
export interface ProfileItemRow {
  chartGroupId: string;
  chartGroupCode: string;
  measurementTypeId: string;
  measurementCode: string;
  measurementLabel: string;
  helpText: string | null;
  chartId: string | null;
  chartVersion: number | null;
  boundaryRule: string | null;
}

export interface ChartRow {
  chartId: string;
  measurementTypeId: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sortOrder: number;
  minInches: string;
  maxInches: string;
}

export interface ProductSizeRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  available: number;
  lowStockThreshold: number;
}

export interface NewDecision {
  customerId: string;
  productId: string;
  measurementProfileId: string;
  method: MeasurementMethod;
  bodyScanSessionId: string | null;
  fitPreference: string;
  recommendedSizeId: string;
  selectedSizeId: string;
  selectionMode: SelectionMode;
  chartSnapshot: unknown;
}

export interface NewMeasurement {
  chartId: string;
  measurementTypeId: string;
  valueInches: number;
  requiredSizeId: string;
}

export interface DecisionRow {
  id: string;
  customerId: string;
  productId: string;
  productSlug: string;
  productName: string;
  method: string;
  fitPreference: string;
  selectionMode: string;
  bodyScanSessionId: string | null;
  chartSnapshot: unknown;
  createdAt: Date;
  recommendedSizeId: string;
  recommendedCode: string;
  recommendedLabel: string;
  selectedSizeId: string;
  selectedCode: string;
  selectedLabel: string;
}

export interface DecisionMeasurementRow {
  decisionId: string;
  code: string;
  label: string;
  valueInches: string;
  chartId: string;
  chartGroup: string;
  chartVersion: number;
  requiredSizeId: string;
  requiredCode: string;
  requiredLabel: string;
}

/** Blueprint reads + append-only decision writes (the DB forbids updates and deletes). */
export interface BlueprintRepository {
  /** Active product (with its active profile, if any). */
  findFittingProduct(db: Database, productId: string): Promise<FittingProductRow | undefined>;
  profileItems(db: Database, profileId: string): Promise<ProfileItemRow[]>;
  chartRows(db: Database, chartIds: string[]): Promise<ChartRow[]>;
  /** Sizes the product is offered in (active variants, active sizes), by size order. */
  productSizes(db: Database, productId: string): Promise<ProductSizeRow[]>;
  activeFitPreferences(db: Database): Promise<{ code: string; label: string }[]>;
  insertDecision(db: Database, decision: NewDecision): Promise<string>;
  insertMeasurements(db: Database, decisionId: string, rows: NewMeasurement[]): Promise<void>;
  /** The customer's own decision only. */
  findDecision(db: Database, id: string, customerId: string): Promise<DecisionRow | undefined>;
  listDecisions(
    db: Database,
    customerId: string,
    filters: { productId?: string | undefined },
    page: PageRequest,
  ): Promise<{ rows: DecisionRow[]; total: number }>;
  decisionMeasurements(db: Database, decisionIds: string[]): Promise<DecisionMeasurementRow[]>;
}

function decisionQuery(db: Database) {
  return db
    .selectFrom('blueprint_decisions as d')
    .innerJoin('products as p', 'p.id', 'd.product_id')
    .innerJoin('sizes as rs', 'rs.id', 'd.recommended_size_id')
    .innerJoin('sizes as ss', 'ss.id', 'd.selected_size_id')
    .select([
      'd.id',
      'd.customer_id as customerId',
      'd.product_id as productId',
      'p.slug as productSlug',
      'p.name as productName',
      'd.measurement_method as method',
      'd.fit_preference as fitPreference',
      'd.selection_mode as selectionMode',
      'd.body_scan_session_id as bodyScanSessionId',
      'd.chart_snapshot as chartSnapshot',
      'd.created_at as createdAt',
      'd.recommended_size_id as recommendedSizeId',
      'rs.code as recommendedCode',
      'rs.label as recommendedLabel',
      'd.selected_size_id as selectedSizeId',
      'ss.code as selectedCode',
      'ss.label as selectedLabel',
    ]);
}

export function createBlueprintRepository(): BlueprintRepository {
  return {
    async findFittingProduct(db, productId) {
      return db
        .selectFrom('products as p')
        .leftJoin('measurement_profiles as mp', (join) =>
          join.onRef('mp.id', '=', 'p.measurement_profile_id').on('mp.is_active', '=', true),
        )
        .select([
          'p.id',
          'p.slug',
          'p.name',
          'mp.id as profileId',
          'mp.code as profileCode',
          'mp.name as profileName',
        ])
        .where('p.id', '=', productId)
        .where('p.status', '=', ACTIVE)
        .executeTakeFirst();
    },

    async profileItems(db, profileId) {
      return db
        .selectFrom('measurement_profile_items as i')
        .innerJoin('size_chart_groups as g', 'g.id', 'i.chart_group_id')
        .innerJoin('measurement_types as m', 'm.id', 'i.measurement_type_id')
        .leftJoin('size_charts as c', (join) =>
          join.onRef('c.group_id', '=', 'g.id').on('c.status', '=', ACTIVE),
        )
        .select([
          'g.id as chartGroupId',
          'g.code as chartGroupCode',
          'm.id as measurementTypeId',
          'm.code as measurementCode',
          'm.label as measurementLabel',
          'm.help_text as helpText',
          'c.id as chartId',
          'c.version as chartVersion',
          'c.boundary_rule as boundaryRule',
        ])
        .where('i.profile_id', '=', profileId)
        .orderBy('i.sort_order')
        .execute();
    },

    async chartRows(db, chartIds) {
      if (chartIds.length === 0) return [];
      return db
        .selectFrom('size_chart_rows as r')
        .innerJoin('sizes as s', 's.id', 'r.size_id')
        .select([
          'r.chart_id as chartId',
          'r.measurement_type_id as measurementTypeId',
          's.id as sizeId',
          's.code as sizeCode',
          's.label as sizeLabel',
          's.sort_order as sortOrder',
          'r.min_inches as minInches',
          'r.max_inches as maxInches',
        ])
        .where('r.chart_id', 'in', chartIds)
        .orderBy('s.sort_order')
        .execute();
    },

    async productSizes(db, productId) {
      return db
        .selectFrom('product_variants as v')
        .innerJoin('sizes as s', 's.id', 'v.size_id')
        .select([
          's.id as sizeId',
          's.code as sizeCode',
          's.label as sizeLabel',
          sql<number>`v.stock_on_hand - v.stock_reserved`.as('available'),
          'v.low_stock_threshold as lowStockThreshold',
        ])
        .where('v.product_id', '=', productId)
        .where('v.is_active', '=', true)
        .where('s.is_active', '=', true)
        .orderBy('s.sort_order')
        .execute();
    },

    async activeFitPreferences(db) {
      return db
        .selectFrom('fit_preferences')
        .select(['code', 'label'])
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute();
    },

    async insertDecision(db, decision) {
      const row = await db
        .insertInto('blueprint_decisions')
        .values({
          customer_id: decision.customerId,
          product_id: decision.productId,
          measurement_profile_id: decision.measurementProfileId,
          measurement_method: decision.method,
          body_scan_session_id: decision.bodyScanSessionId,
          fit_preference: decision.fitPreference,
          recommended_size_id: decision.recommendedSizeId,
          selected_size_id: decision.selectedSizeId,
          selection_mode: decision.selectionMode,
          chart_snapshot: JSON.stringify(decision.chartSnapshot),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async insertMeasurements(db, decisionId, rows) {
      if (rows.length === 0) return;
      await db
        .insertInto('blueprint_measurements')
        .values(
          rows.map((row) => ({
            decision_id: decisionId,
            chart_id: row.chartId,
            measurement_type_id: row.measurementTypeId,
            value_inches: row.valueInches,
            required_size_id: row.requiredSizeId,
          })),
        )
        .execute();
    },

    async findDecision(db, id, customerId) {
      return decisionQuery(db)
        .where('d.id', '=', id)
        .where('d.customer_id', '=', customerId)
        .executeTakeFirst();
    },

    async listDecisions(db, customerId, filters, page) {
      let query = decisionQuery(db).where('d.customer_id', '=', customerId);
      if (filters.productId !== undefined)
        query = query.where('d.product_id', '=', filters.productId);
      const [rows, count] = await Promise.all([
        query
          .orderBy('d.created_at', 'desc')
          .orderBy('d.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('blueprint_decisions')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where('customer_id', '=', customerId)
          .$if(filters.productId !== undefined, (q) =>
            q.where('product_id', '=', filters.productId ?? ''),
          )
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async decisionMeasurements(db, decisionIds) {
      if (decisionIds.length === 0) return [];
      return db
        .selectFrom('blueprint_measurements as bm')
        .innerJoin('measurement_types as m', 'm.id', 'bm.measurement_type_id')
        .innerJoin('size_charts as c', 'c.id', 'bm.chart_id')
        .innerJoin('size_chart_groups as g', 'g.id', 'c.group_id')
        .innerJoin('sizes as s', 's.id', 'bm.required_size_id')
        .select([
          'bm.decision_id as decisionId',
          'm.code',
          'm.label',
          'bm.value_inches as valueInches',
          'bm.chart_id as chartId',
          'g.code as chartGroup',
          'c.version as chartVersion',
          's.id as requiredSizeId',
          's.code as requiredCode',
          's.label as requiredLabel',
        ])
        .where('bm.decision_id', 'in', decisionIds)
        .orderBy('g.sort_order')
        .orderBy('m.sort_order')
        .execute();
    },
  };
}
