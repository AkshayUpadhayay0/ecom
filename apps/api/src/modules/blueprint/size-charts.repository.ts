import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface GroupRow {
  id: string;
  code: string;
  name: string;
  audience: string;
  isActive: boolean;
  activeChartId: string | null;
  activeChartVersion: number | null;
  activeChartEffectiveFrom: Date | null;
}

export interface MeasurementTypeRow {
  id: string;
  code: string;
  label: string;
}

export interface ChartRow {
  id: string;
  groupId: string;
  groupCode: string;
  groupName: string;
  version: number;
  name: string;
  status: string;
  boundaryRule: string;
  isSampleData: boolean;
  sourceNote: string | null;
  rowCount: number;
  effectiveFrom: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
}

export interface ChartCellRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sortOrder: number;
  measurementCode: string;
  /** numeric(5,1) arrives as a string. */
  minInches: string;
  maxInches: string;
}

export interface ProfileRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface ProfileItemRow {
  profileId: string;
  groupId: string;
  groupCode: string;
  groupName: string;
  measurementTypeId: string;
  measurementCode: string;
  measurementLabel: string;
}

export interface ProfileProductRow {
  profileId: string;
  id: string;
  name: string;
  slug: string;
  status: string;
}

const ACTIVE_STATUS = 'active';

function chartQuery(db: Database) {
  return db
    .selectFrom('size_charts as c')
    .innerJoin('size_chart_groups as g', 'g.id', 'c.group_id')
    .select((eb) => [
      'c.id',
      'c.group_id as groupId',
      'g.code as groupCode',
      'g.name as groupName',
      'c.version',
      'c.name',
      'c.status',
      'c.boundary_rule as boundaryRule',
      'c.is_sample_data as isSampleData',
      'c.source_note as sourceNote',
      eb
        .selectFrom('size_chart_rows as r')
        .select((sub) => sub.fn.countAll<string>().as('n'))
        .whereRef('r.chart_id', '=', 'c.id')
        .as('rowCount'),
      'c.effective_from as effectiveFrom',
      'c.retired_at as retiredAt',
      'c.created_at as createdAt',
    ]);
}

function toChartRow<T extends { rowCount: string | null }>(
  row: T,
): Omit<T, 'rowCount'> & {
  rowCount: number;
} {
  return { ...row, rowCount: Number(row.rowCount ?? 0) };
}

/** Read-only access to size charts and measurement profiles (no write methods by design). */
export interface SizeChartsRepository {
  listGroups(db: Database, page: PageRequest): Promise<{ rows: GroupRow[]; total: number }>;
  groupExists(db: Database, groupId: string): Promise<boolean>;
  /** Required measurements per group, in display order. */
  groupMeasurements(db: Database, groupIds: string[]): Promise<Map<string, MeasurementTypeRow[]>>;
  listCharts(
    db: Database,
    groupId: string,
    page: PageRequest,
  ): Promise<{ rows: ChartRow[]; total: number }>;
  findChart(db: Database, chartId: string): Promise<ChartRow | undefined>;
  chartCells(db: Database, chartId: string): Promise<ChartCellRow[]>;
  listProfiles(db: Database, page: PageRequest): Promise<{ rows: ProfileRow[]; total: number }>;
  profileItems(db: Database, profileIds: string[]): Promise<ProfileItemRow[]>;
  profileProductCounts(db: Database, profileIds: string[]): Promise<Map<string, number>>;
  /** Up to `limit` products per profile (by name). */
  profileProducts(db: Database, profileIds: string[], limit: number): Promise<ProfileProductRow[]>;
}

export function createSizeChartsRepository(): SizeChartsRepository {
  return {
    async listGroups(db, page) {
      const [rows, count] = await Promise.all([
        db
          .selectFrom('size_chart_groups as g')
          .leftJoin('size_charts as c', (join) =>
            join.onRef('c.group_id', '=', 'g.id').on('c.status', '=', ACTIVE_STATUS),
          )
          .select([
            'g.id',
            'g.code',
            'g.name',
            'g.audience',
            'g.is_active as isActive',
            'c.id as activeChartId',
            'c.version as activeChartVersion',
            'c.effective_from as activeChartEffectiveFrom',
          ])
          .orderBy('g.sort_order')
          .orderBy('g.code')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('size_chart_groups')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async groupExists(db, groupId) {
      const row = await db
        .selectFrom('size_chart_groups')
        .select('id')
        .where('id', '=', groupId)
        .executeTakeFirst();
      return row !== undefined;
    },

    async groupMeasurements(db, groupIds) {
      const result = new Map<string, MeasurementTypeRow[]>(groupIds.map((id) => [id, []]));
      if (groupIds.length === 0) return result;
      const rows = await db
        .selectFrom('size_chart_group_measurements as gm')
        .innerJoin('measurement_types as m', 'm.id', 'gm.measurement_type_id')
        .select(['gm.group_id as groupId', 'm.id', 'm.code', 'm.label'])
        .where('gm.group_id', 'in', groupIds)
        .orderBy('gm.sort_order')
        .orderBy('m.sort_order')
        .execute();
      for (const { groupId, ...type } of rows) result.get(groupId)?.push(type);
      return result;
    },

    async listCharts(db, groupId, page) {
      const [rows, count] = await Promise.all([
        chartQuery(db)
          .where('c.group_id', '=', groupId)
          .orderBy('c.version', 'desc')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('size_charts')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where('group_id', '=', groupId)
          .executeTakeFirstOrThrow(),
      ]);
      return { rows: rows.map(toChartRow), total: Number(count.total) };
    },

    async findChart(db, chartId) {
      const row = await chartQuery(db).where('c.id', '=', chartId).executeTakeFirst();
      return row && toChartRow(row);
    },

    async chartCells(db, chartId) {
      return db
        .selectFrom('size_chart_rows as r')
        .innerJoin('sizes as s', 's.id', 'r.size_id')
        .innerJoin('measurement_types as m', 'm.id', 'r.measurement_type_id')
        .select([
          's.id as sizeId',
          's.code as sizeCode',
          's.label as sizeLabel',
          's.sort_order as sortOrder',
          'm.code as measurementCode',
          'r.min_inches as minInches',
          'r.max_inches as maxInches',
        ])
        .where('r.chart_id', '=', chartId)
        .orderBy('s.sort_order')
        .orderBy('s.code')
        .execute();
    },

    async listProfiles(db, page) {
      const [rows, count] = await Promise.all([
        db
          .selectFrom('measurement_profiles')
          .select(['id', 'code', 'name', 'description', 'is_active as isActive'])
          .orderBy('code')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('measurement_profiles')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async profileItems(db, profileIds) {
      if (profileIds.length === 0) return [];
      return db
        .selectFrom('measurement_profile_items as i')
        .innerJoin('size_chart_groups as g', 'g.id', 'i.chart_group_id')
        .innerJoin('measurement_types as m', 'm.id', 'i.measurement_type_id')
        .select([
          'i.profile_id as profileId',
          'g.id as groupId',
          'g.code as groupCode',
          'g.name as groupName',
          'm.id as measurementTypeId',
          'm.code as measurementCode',
          'm.label as measurementLabel',
        ])
        .where('i.profile_id', 'in', profileIds)
        .orderBy('i.sort_order')
        .execute();
    },

    async profileProductCounts(db, profileIds) {
      const counts = new Map<string, number>();
      if (profileIds.length === 0) return counts;
      const rows = await db
        .selectFrom('products')
        .select((eb) => ['measurement_profile_id as profileId', eb.fn.countAll<string>().as('n')])
        .where('measurement_profile_id', 'in', profileIds)
        .where('deleted_at', 'is', null)
        .groupBy('measurement_profile_id')
        .execute();
      for (const row of rows) if (row.profileId !== null) counts.set(row.profileId, Number(row.n));
      return counts;
    },

    async profileProducts(db, profileIds, limit) {
      if (profileIds.length === 0) return [];
      const result = await sql<ProfileProductRow>`
        SELECT "profileId", id, name, slug, status FROM (
          SELECT p.measurement_profile_id AS "profileId", p.id, p.name, p.slug, p.status,
                 row_number() OVER (PARTITION BY p.measurement_profile_id ORDER BY p.name, p.id) AS n
          FROM products p
          WHERE p.measurement_profile_id = ANY(${profileIds}::uuid[]) AND p.deleted_at IS NULL
        ) ranked
        WHERE n <= ${limit}
        ORDER BY "profileId", n`.execute(db);
      return result.rows;
    },
  };
}
