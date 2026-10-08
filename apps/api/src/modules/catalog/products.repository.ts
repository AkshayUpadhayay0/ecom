import { sql } from 'kysely';
import type { ProductStatus } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

/**
 * Transaction-scoped advisory lock serialising every change that can increase the number of
 * active products, so two concurrent activations cannot both pass the cap check.
 */
const ACTIVE_CAP_LOCK_KEY = 'catalog.max_active_products';

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  clothingTypeId: string;
  clothingTypeSlug: string;
  /** Name in the default language (null if that translation is missing). */
  clothingTypeName: string | null;
  garmentCutId: string | null;
  garmentCutCode: string | null;
  garmentCutName: string | null;
  priceMinor: string;
  currency: string;
  status: ProductStatus;
  displayOrder: number;
  searchKeywords: string;
  videoAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductFilters {
  q?: string | undefined;
  status?: ProductStatus | undefined;
  clothingTypeId?: string | undefined;
  garmentCutId?: string | undefined;
  sort: 'displayOrder' | 'name' | 'priceMinor' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
}

export interface ProductValues {
  name: string;
  slug: string;
  clothingTypeId: string;
  garmentCutId: string | null;
  priceMinor: number;
  searchKeywords: string;
  displayOrder: number;
  status: ProductStatus;
}

export type ProductPatch = Partial<Omit<ProductValues, 'status'>>;

const SORT_COLUMNS = {
  displayOrder: 'p.display_order',
  name: 'p.name',
  priceMinor: 'p.price_minor',
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
} as const;

function baseQuery(db: Database) {
  return db
    .selectFrom('products as p')
    .innerJoin('clothing_types as ct', 'ct.id', 'p.clothing_type_id')
    .leftJoin('garment_cuts as gc', 'gc.id', 'p.garment_cut_id')
    .leftJoin('clothing_type_translations as ctt', (join) =>
      join
        .onRef('ctt.clothing_type_id', '=', 'ct.id')
        .on(
          'ctt.language_code',
          '=',
          sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`,
        ),
    );
}

const COLUMNS = [
  'p.id',
  'p.slug',
  'p.name',
  'p.clothing_type_id as clothingTypeId',
  'ct.slug as clothingTypeSlug',
  'ctt.name as clothingTypeName',
  'p.garment_cut_id as garmentCutId',
  'gc.code as garmentCutCode',
  'gc.name as garmentCutName',
  'p.price_minor as priceMinor',
  'p.currency',
  'p.status',
  'p.display_order as displayOrder',
  'p.search_keywords as searchKeywords',
  'p.video_asset_id as videoAssetId',
  'p.created_at as createdAt',
  'p.updated_at as updatedAt',
] as const;

/** `status` is CHECK-constrained to the ProductStatus values. */
function toProductRow<T extends { status: string }>(row: T): T & { status: ProductStatus } {
  return { ...row, status: row.status as ProductStatus };
}

export interface ProductsRepository {
  list(
    db: Database,
    filters: ProductFilters,
    page: PageRequest,
  ): Promise<{ rows: ProductRow[]; total: number }>;
  /** `lock` takes a row lock on the product (inside a transaction). */
  findById(db: Database, id: string, lock?: boolean): Promise<ProductRow | undefined>;
  descriptionsFor(db: Database, id: string): Promise<Record<string, string>>;
  /** Returns undefined if the slug is taken. */
  insert(db: Database, values: ProductValues): Promise<string | undefined>;
  /** Returns false if the new slug is taken. */
  update(db: Database, id: string, patch: ProductPatch): Promise<boolean>;
  setStatus(db: Database, id: string, status: ProductStatus): Promise<void>;
  setVideo(db: Database, id: string, mediaAssetId: string): Promise<void>;
  upsertDescriptions(db: Database, id: string, descriptions: Record<string, string>): Promise<void>;
  deleteDescriptions(db: Database, id: string, languageCodes: string[]): Promise<void>;
  /** Blocks until no other transaction can change the active-product count. */
  lockActiveCap(db: Database): Promise<void>;
  countActive(db: Database): Promise<number>;
}

export function createProductsRepository(): ProductsRepository {
  return {
    async list(db, filters, page) {
      let query = baseQuery(db);
      if (filters.status !== undefined) query = query.where('p.status', '=', filters.status);
      if (filters.clothingTypeId !== undefined) {
        query = query.where('p.clothing_type_id', '=', filters.clothingTypeId);
      }
      if (filters.garmentCutId !== undefined) {
        query = query.where('p.garment_cut_id', '=', filters.garmentCutId);
      }
      if (filters.q !== undefined) {
        const pattern = `%${escapeLike(filters.q)}%`;
        query = query.where((eb) =>
          eb.or([
            eb('p.name', 'ilike', pattern),
            eb('p.slug', 'ilike', pattern),
            eb('p.search_keywords', 'ilike', pattern),
          ]),
        );
      }
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy(SORT_COLUMNS[filters.sort], filters.order)
          .orderBy('p.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows: rows.map(toProductRow), total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = baseQuery(db).select(COLUMNS).where('p.id', '=', id);
      if (lock) query = query.forUpdate('p');
      const row = await query.executeTakeFirst();
      return row && toProductRow(row);
    },

    async descriptionsFor(db, id) {
      const rows = await db
        .selectFrom('product_translations')
        .select(['language_code as languageCode', 'description'])
        .where('product_id', '=', id)
        .execute();
      return Object.fromEntries(rows.map((row) => [row.languageCode, row.description]));
    },

    async insert(db, values) {
      try {
        const row = await db
          .insertInto('products')
          .values({
            name: values.name,
            slug: values.slug,
            clothing_type_id: values.clothingTypeId,
            garment_cut_id: values.garmentCutId,
            price_minor: values.priceMinor,
            search_keywords: values.searchKeywords,
            display_order: values.displayOrder,
            status: values.status,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return undefined;
        throw err;
      }
    },

    async update(db, id, patch) {
      try {
        await db
          .updateTable('products')
          .set({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.slug !== undefined && { slug: patch.slug }),
            ...(patch.clothingTypeId !== undefined && { clothing_type_id: patch.clothingTypeId }),
            ...(patch.garmentCutId !== undefined && { garment_cut_id: patch.garmentCutId }),
            ...(patch.priceMinor !== undefined && { price_minor: patch.priceMinor }),
            ...(patch.searchKeywords !== undefined && { search_keywords: patch.searchKeywords }),
            ...(patch.displayOrder !== undefined && { display_order: patch.displayOrder }),
          })
          .where('id', '=', id)
          .execute();
        return true;
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return false;
        throw err;
      }
    },

    async setStatus(db, id, status) {
      await db.updateTable('products').set({ status }).where('id', '=', id).execute();
    },

    async setVideo(db, id, mediaAssetId) {
      await db
        .updateTable('products')
        .set({ video_asset_id: mediaAssetId })
        .where('id', '=', id)
        .execute();
    },

    async upsertDescriptions(db, id, descriptions) {
      const rows = Object.entries(descriptions).map(([languageCode, description]) => ({
        product_id: id,
        language_code: languageCode,
        description,
      }));
      if (rows.length === 0) return;
      await db
        .insertInto('product_translations')
        .values(rows)
        .onConflict((oc) =>
          oc
            .columns(['product_id', 'language_code'])
            .doUpdateSet((eb) => ({ description: eb.ref('excluded.description') })),
        )
        .execute();
    },

    async deleteDescriptions(db, id, languageCodes) {
      if (languageCodes.length === 0) return;
      await db
        .deleteFrom('product_translations')
        .where('product_id', '=', id)
        .where('language_code', 'in', languageCodes)
        .execute();
    },

    async lockActiveCap(db) {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${ACTIVE_CAP_LOCK_KEY}))`.execute(db);
    },

    async countActive(db) {
      const row = await db
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      return Number(row.total);
    },
  };
}
