import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

/** CHECK (NOT is_active OR fee_minor IS NOT NULL), unnamed in schema_v2.sql. */
const ACTIVE_NEEDS_FEE_CONSTRAINT = 'delivery_zones_check1';

export interface DeliveryZoneRow {
  id: string;
  code: string;
  name: string;
  feeMinor: string | null;
  estDaysMin: number | null;
  estDaysMax: number | null;
  isActive: boolean;
  isSampleData: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryZoneValues {
  code: string;
  name: string;
  feeMinor: number | null;
  estDaysMin: number | null;
  estDaysMax: number | null;
  isActive: boolean;
  sortOrder: number;
}

export type DeliveryZonePatch = Partial<Omit<DeliveryZoneValues, 'code'>>;

/** Why a write was refused by the database. */
export type ZoneWriteFailure = 'code_taken' | 'fee_required';

const COLUMNS = [
  'id',
  'code',
  'name',
  'fee_minor as feeMinor',
  'est_days_min as estDaysMin',
  'est_days_max as estDaysMax',
  'is_active as isActive',
  'is_sample_data as isSampleData',
  'sort_order as sortOrder',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

function failureOf(err: unknown): ZoneWriteFailure | undefined {
  if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return 'code_taken';
  if (isPgErrorCode(err, PG_ERROR.CHECK_VIOLATION, ACTIVE_NEEDS_FEE_CONSTRAINT)) {
    return 'fee_required';
  }
  return undefined;
}

export interface DeliveryZonesRepository {
  list(
    db: Database,
    filters: { q?: string | undefined; isActive?: boolean | undefined; order: 'asc' | 'desc' },
    page: PageRequest,
  ): Promise<{ rows: DeliveryZoneRow[]; total: number }>;
  findById(db: Database, id: string, lock?: boolean): Promise<DeliveryZoneRow | undefined>;
  insert(db: Database, values: DeliveryZoneValues): Promise<DeliveryZoneRow | ZoneWriteFailure>;
  update(
    db: Database,
    id: string,
    patch: DeliveryZonePatch,
  ): Promise<DeliveryZoneRow | ZoneWriteFailure | undefined>;
}

export function createDeliveryZonesRepository(): DeliveryZonesRepository {
  return {
    async list(db, filters, page) {
      let query = db.selectFrom('delivery_zones');
      if (filters.isActive !== undefined) query = query.where('is_active', '=', filters.isActive);
      if (filters.q !== undefined) {
        const pattern = `%${escapeLike(filters.q)}%`;
        query = query.where((eb) =>
          eb.or([eb('code', 'ilike', pattern), eb('name', 'ilike', pattern)]),
        );
      }
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy('sort_order', filters.order)
          .orderBy('name')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = db.selectFrom('delivery_zones').select(COLUMNS).where('id', '=', id);
      if (lock) query = query.forUpdate();
      return query.executeTakeFirst();
    },

    async insert(db, values) {
      try {
        return await db
          .insertInto('delivery_zones')
          .values({
            code: values.code,
            name: values.name,
            fee_minor: values.feeMinor,
            est_days_min: values.estDaysMin,
            est_days_max: values.estDaysMax,
            is_active: values.isActive,
            sort_order: values.sortOrder,
          })
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (err) {
        const failure = failureOf(err);
        if (failure) return failure;
        throw err;
      }
    },

    async update(db, id, patch) {
      try {
        return await db
          .updateTable('delivery_zones')
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.feeMinor !== undefined && { fee_minor: patch.feeMinor }),
            ...(patch.estDaysMin !== undefined && { est_days_min: patch.estDaysMin }),
            ...(patch.estDaysMax !== undefined && { est_days_max: patch.estDaysMax }),
            ...(patch.isActive !== undefined && { is_active: patch.isActive }),
            ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
          })
          .where('id', '=', id)
          .returning(COLUMNS)
          .executeTakeFirst();
      } catch (err) {
        const failure = failureOf(err);
        if (failure) return failure;
        throw err;
      }
    },
  };
}
