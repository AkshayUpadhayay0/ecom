import { sql } from 'kysely';
import type { StockMovementType } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { PG_ERROR, isPgErrorCode, pgConstraintOf } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

/** Unique constraint on SKU (Postgres default name for `sku text UNIQUE`). */
const SKU_UNIQUE_CONSTRAINT = 'product_variants_sku_key';

export interface VariantRow {
  id: string;
  productId: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sku: string;
  stockOnHand: number;
  stockReserved: number;
  lowStockThreshold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LowStockRow extends VariantRow {
  productName: string;
  productSlug: string;
  productStatus: string;
}

export interface NewVariant {
  productId: string;
  sizeId: string;
  sku: string;
  lowStockThreshold?: number | undefined;
  isActive: boolean;
}

export interface VariantPatch {
  sku?: string;
  lowStockThreshold?: number;
  isActive?: boolean;
}

/** Either add `delta` units or set an absolute on-hand count. */
export type StockChange = { kind: 'delta'; delta: number } | { kind: 'set'; onHand: number };

export interface StockChangeResult {
  previousOnHand: number;
  stockOnHand: number;
  stockReserved: number;
}

export interface NewStockMovement {
  variantId: string;
  type: StockMovementType;
  quantityDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  adminId: string | null;
}

export interface StockMovementRow {
  id: string;
  variantId: string;
  type: string;
  quantityDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  adminId: string | null;
  adminDisplayName: string | null;
  createdAt: Date;
}

export type InsertVariantResult =
  { ok: true; row: VariantRow } | { ok: false; conflict: 'sku' | 'size' };

function variantQuery(db: Database) {
  return db.selectFrom('product_variants as v').innerJoin('sizes as s', 's.id', 'v.size_id');
}

const VARIANT_COLUMNS = [
  'v.id',
  'v.product_id as productId',
  'v.size_id as sizeId',
  's.code as sizeCode',
  's.label as sizeLabel',
  'v.sku',
  'v.stock_on_hand as stockOnHand',
  'v.stock_reserved as stockReserved',
  'v.low_stock_threshold as lowStockThreshold',
  'v.is_active as isActive',
  'v.created_at as createdAt',
  'v.updated_at as updatedAt',
] as const;

const ARCHIVED_PRODUCT_STATUS = 'archived';

export interface VariantsRepository {
  listForProduct(
    db: Database,
    productId: string,
    filters: { isActive?: boolean | undefined; order: 'asc' | 'desc' },
    page: PageRequest,
  ): Promise<{ rows: VariantRow[]; total: number }>;
  findById(db: Database, id: string, lock?: boolean): Promise<VariantRow | undefined>;
  insert(db: Database, variant: NewVariant): Promise<InsertVariantResult>;
  /** Returns 'sku_taken' if the new SKU is used by another variant. */
  update(
    db: Database,
    id: string,
    patch: VariantPatch,
  ): Promise<VariantRow | 'sku_taken' | undefined>;
  /**
   * ONE conditional UPDATE (never read-then-write). The row lock is taken by the statement
   * itself; it only applies if the new on-hand count stays >= stock_reserved. Returns undefined
   * when no row changed (unknown variant, or the change would go below reserved units).
   */
  changeStock(
    db: Database,
    id: string,
    change: StockChange,
  ): Promise<StockChangeResult | undefined>;
  hasMovements(db: Database, variantId: string): Promise<boolean>;
  insertMovement(db: Database, movement: NewStockMovement): Promise<StockMovementRow>;
  listMovements(
    db: Database,
    variantId: string,
    order: 'asc' | 'desc',
    page: PageRequest,
  ): Promise<{ rows: StockMovementRow[]; total: number }>;
  /** Active variants of non-archived products with available <= low_stock_threshold. */
  listLowStock(
    db: Database,
    order: 'asc' | 'desc',
    page: PageRequest,
  ): Promise<{ rows: LowStockRow[]; total: number }>;
}

export function createVariantsRepository(): VariantsRepository {
  async function findMovement(db: Database, id: string): Promise<StockMovementRow> {
    return db
      .selectFrom('stock_movements as m')
      .leftJoin('admin_users as a', 'a.id', 'm.admin_id')
      .select([
        'm.id',
        'm.variant_id as variantId',
        'm.movement_type as type',
        'm.quantity_delta as quantityDelta',
        'm.reference_type as referenceType',
        'm.reference_id as referenceId',
        'm.note',
        'm.admin_id as adminId',
        'a.display_name as adminDisplayName',
        'm.created_at as createdAt',
      ])
      .where('m.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  return {
    async listForProduct(db, productId, filters, page) {
      let query = variantQuery(db).where('v.product_id', '=', productId);
      if (filters.isActive !== undefined) query = query.where('v.is_active', '=', filters.isActive);
      const [rows, count] = await Promise.all([
        query
          .select(VARIANT_COLUMNS)
          .orderBy('s.sort_order', filters.order)
          .orderBy('v.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = variantQuery(db).select(VARIANT_COLUMNS).where('v.id', '=', id);
      if (lock) query = query.forUpdate('v');
      return query.executeTakeFirst();
    },

    async insert(db, variant) {
      try {
        const { id } = await db
          .insertInto('product_variants')
          .values({
            product_id: variant.productId,
            size_id: variant.sizeId,
            sku: variant.sku,
            is_active: variant.isActive,
            ...(variant.lowStockThreshold !== undefined && {
              low_stock_threshold: variant.lowStockThreshold,
            }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const row = await variantQuery(db)
          .select(VARIANT_COLUMNS)
          .where('v.id', '=', id)
          .executeTakeFirstOrThrow();
        return { ok: true, row };
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) {
          return {
            ok: false,
            conflict: pgConstraintOf(err) === SKU_UNIQUE_CONSTRAINT ? 'sku' : 'size',
          };
        }
        throw err;
      }
    },

    async update(db, id, patch) {
      try {
        const updated = await db
          .updateTable('product_variants')
          .set({
            ...(patch.sku !== undefined && { sku: patch.sku }),
            ...(patch.lowStockThreshold !== undefined && {
              low_stock_threshold: patch.lowStockThreshold,
            }),
            ...(patch.isActive !== undefined && { is_active: patch.isActive }),
          })
          .where('id', '=', id)
          .returning('id')
          .executeTakeFirst();
        if (!updated) return undefined;
        return await variantQuery(db)
          .select(VARIANT_COLUMNS)
          .where('v.id', '=', id)
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION, SKU_UNIQUE_CONSTRAINT))
          return 'sku_taken';
        throw err;
      }
    },

    async changeStock(db, id, change) {
      const newOnHand =
        change.kind === 'set'
          ? sql<number>`${change.onHand}::int`
          : sql<number>`v.stock_on_hand + ${change.delta}::int`;
      // The FROM sub-select locks the row and captures the previous count for the ledger;
      // the WHERE clause is the guard (never below reserved units, hence never below zero).
      const result = await sql<{
        previousOnHand: number;
        stockOnHand: number;
        stockReserved: number;
      }>`
        UPDATE product_variants AS v
        SET stock_on_hand = ${newOnHand},
            row_version = v.row_version + 1
        FROM (SELECT id, stock_on_hand AS previous
              FROM product_variants WHERE id = ${id} FOR UPDATE) AS old
        WHERE v.id = old.id
          AND ${newOnHand} >= v.stock_reserved
        RETURNING old.previous AS "previousOnHand",
                  v.stock_on_hand AS "stockOnHand",
                  v.stock_reserved AS "stockReserved"`.execute(db);
      return result.rows[0];
    },

    async hasMovements(db, variantId) {
      const row = await db
        .selectFrom('stock_movements')
        .select('id')
        .where('variant_id', '=', variantId)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async insertMovement(db, movement) {
      const { id } = await db
        .insertInto('stock_movements')
        .values({
          variant_id: movement.variantId,
          movement_type: movement.type,
          quantity_delta: movement.quantityDelta,
          reference_type: movement.referenceType,
          reference_id: movement.referenceId,
          note: movement.note,
          admin_id: movement.adminId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return findMovement(db, id);
    },

    async listMovements(db, variantId, order, page) {
      const query = db
        .selectFrom('stock_movements as m')
        .leftJoin('admin_users as a', 'a.id', 'm.admin_id')
        .where('m.variant_id', '=', variantId);
      const [rows, count] = await Promise.all([
        query
          .select([
            'm.id',
            'm.variant_id as variantId',
            'm.movement_type as type',
            'm.quantity_delta as quantityDelta',
            'm.reference_type as referenceType',
            'm.reference_id as referenceId',
            'm.note',
            'm.admin_id as adminId',
            'a.display_name as adminDisplayName',
            'm.created_at as createdAt',
          ])
          .orderBy('m.created_at', order)
          .orderBy('m.id', order)
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async listLowStock(db, order, page) {
      const query = variantQuery(db)
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .where('v.is_active', '=', true)
        .where('p.status', '<>', ARCHIVED_PRODUCT_STATUS)
        .where(sql<boolean>`v.stock_on_hand - v.stock_reserved <= v.low_stock_threshold`);
      const [rows, count] = await Promise.all([
        query
          .select([
            ...VARIANT_COLUMNS,
            'p.name as productName',
            'p.slug as productSlug',
            'p.status as productStatus',
          ])
          .orderBy(sql`v.stock_on_hand - v.stock_reserved`, order)
          .orderBy('p.name')
          .orderBy('s.sort_order')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },
  };
}
