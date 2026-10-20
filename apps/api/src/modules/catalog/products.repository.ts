import { sql } from 'kysely';
import type { ProductStatus } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

/**
 * Transaction-scoped advisory lock serialising every change that can increase the number of
 * active products, so two concurrent activations cannot both pass an (optional) cap check.
 */
const ACTIVE_CAP_LOCK_KEY = 'catalog.max_active_products';

/** The default language, read from data (never hard-coded). */
const DEFAULT_LANGUAGE = sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`;

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  clothingTypeId: string;
  clothingTypeSlug: string;
  /** Name in the default language (null if that row is missing). */
  clothingTypeName: string | null;
  measurementProfileId: string | null;
  measurementProfileCode: string | null;
  measurementProfileName: string | null;
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
  measurementProfileId?: string | undefined;
  sort: 'displayOrder' | 'name' | 'priceMinor' | 'createdAt' | 'updatedAt';
  order: 'asc' | 'desc';
}

export interface ProductValues {
  name: string;
  slug: string;
  clothingTypeId: string;
  measurementProfileId: string | null;
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

/**
 * Every admin product query: soft-deleted products (migration 0014) are invisible here, so they
 * are gone from lists, detail, pickers and inventory.
 */
function baseQuery(db: Database) {
  return db
    .selectFrom('products as p')
    .where('p.deleted_at', 'is', null)
    .innerJoin('clothing_types as ct', 'ct.id', 'p.clothing_type_id')
    .leftJoin('measurement_profiles as mp', 'mp.id', 'p.measurement_profile_id')
    .leftJoin('clothing_type_translations as ctt', (join) =>
      join
        .onRef('ctt.clothing_type_id', '=', 'ct.id')
        .on('ctt.language_code', '=', DEFAULT_LANGUAGE),
    );
}

const COLUMNS = [
  'p.id',
  'p.slug',
  'p.name',
  'p.clothing_type_id as clothingTypeId',
  'ct.slug as clothingTypeSlug',
  'ctt.name as clothingTypeName',
  'p.measurement_profile_id as measurementProfileId',
  'mp.code as measurementProfileCode',
  'mp.name as measurementProfileName',
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

/** Orders that are not paid yet: the product may still be bought through them. */
const UNPAID_ORDER_STATUSES = ['pending_payment', 'payment_failed', 'payment_review'];
const HELD = 'held';
const ACTIVE_CART = 'active';

export interface DeletionBlockers {
  unpaidOrders: number;
  activeReservations: number;
  openReturns: number;
  pendingMedia: number;
}

export interface ProductsRepository {
  list(
    db: Database,
    filters: ProductFilters,
    page: PageRequest,
  ): Promise<{ rows: ProductRow[]; total: number }>;
  /** `lock` takes a row lock on the product (inside a transaction). */
  findById(db: Database, id: string, lock?: boolean): Promise<ProductRow | undefined>;
  /** Canonical description (default-language row), or null. */
  descriptionOf(db: Database, id: string): Promise<string | null>;
  setDescription(db: Database, id: string, description: string): Promise<void>;
  imageAssetIds(db: Database, id: string): Promise<string[]>;
  /** Replaces the image list; array order = display order. */
  setImages(db: Database, id: string, mediaAssetIds: string[]): Promise<void>;
  /** What still prevents deleting the product (counts; all zero = deletable). */
  deletionBlockers(db: Database, productId: string): Promise<DeletionBlockers>;
  /** Locks the product's variant rows (sorted), so no checkout can reserve them meanwhile. */
  lockVariants(db: Database, productId: string): Promise<void>;
  /** Removes the product's lines from customers' ACTIVE carts; returns how many. */
  removeFromActiveCarts(db: Database, productId: string): Promise<number>;
  /** Detaches video and images (media stays in the library, unused); returns the asset ids. */
  detachMedia(db: Database, productId: string): Promise<string[]>;
  /** Deactivates every variant; returns how many were active. */
  deactivateVariants(db: Database, productId: string): Promise<number>;
  /** Soft delete: archived + deleted_at / deleted_by. */
  markDeleted(db: Database, productId: string, adminId: string): Promise<Date>;
  /** Returns undefined if the slug is taken. */
  insert(db: Database, values: ProductValues): Promise<string | undefined>;
  /** Returns false if the new slug is taken. */
  update(db: Database, id: string, patch: ProductPatch): Promise<boolean>;
  setStatus(db: Database, id: string, status: ProductStatus): Promise<void>;
  setVideo(db: Database, id: string, mediaAssetId: string): Promise<void>;
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
      if (filters.measurementProfileId !== undefined) {
        query = query.where('p.measurement_profile_id', '=', filters.measurementProfileId);
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

    async deletionBlockers(db, productId) {
      const result = await sql<DeletionBlockers>`
        SELECT
          (SELECT count(DISTINCT o.id)::int FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
            WHERE oi.product_id = ${productId}
              AND o.order_status = ANY(${UNPAID_ORDER_STATUSES}::text[])) AS "unpaidOrders",
          (SELECT count(*)::int FROM stock_reservations r
             JOIN product_variants v ON v.id = r.variant_id
            WHERE v.product_id = ${productId} AND r.status = ${HELD}) AS "activeReservations",
          (SELECT count(DISTINCT rr.id)::int FROM return_requests rr
             JOIN return_statuses s ON s.code = rr.status AND NOT s.is_terminal
             JOIN order_items oi ON oi.id = rr.order_item_id
             LEFT JOIN product_variants rv ON rv.id = rr.replacement_variant_id
            WHERE oi.product_id = ${productId} OR rv.product_id = ${productId}) AS "openReturns",
          (SELECT count(*)::int FROM product_pending_media pm
            WHERE pm.product_id = ${productId}) AS "pendingMedia"`.execute(db);
      return (
        result.rows[0] ?? {
          unpaidOrders: 0,
          activeReservations: 0,
          openReturns: 0,
          pendingMedia: 0,
        }
      );
    },

    async lockVariants(db, productId) {
      await db
        .selectFrom('product_variants')
        .select('id')
        .where('product_id', '=', productId)
        .orderBy('id')
        .forUpdate()
        .execute();
    },

    async removeFromActiveCarts(db, productId) {
      const rows = await db
        .deleteFrom('cart_items')
        .where('variant_id', 'in', (eb) =>
          eb.selectFrom('product_variants').select('id').where('product_id', '=', productId),
        )
        .where('cart_id', 'in', (eb) =>
          eb.selectFrom('carts').select('id').where('status', '=', ACTIVE_CART),
        )
        .returning('id')
        .execute();
      return rows.length;
    },

    async detachMedia(db, productId) {
      const product = await db
        .selectFrom('products')
        .select('video_asset_id')
        .where('id', '=', productId)
        .executeTakeFirst();
      const images = await db
        .deleteFrom('product_images')
        .where('product_id', '=', productId)
        .returning('media_asset_id')
        .execute();
      await db
        .updateTable('products')
        .set({ video_asset_id: null })
        .where('id', '=', productId)
        .execute();
      return [
        ...(product?.video_asset_id ? [product.video_asset_id] : []),
        ...images.map((row) => row.media_asset_id),
      ];
    },

    async deactivateVariants(db, productId) {
      const rows = await db
        .updateTable('product_variants')
        .set({ is_active: false })
        .where('product_id', '=', productId)
        .where('is_active', '=', true)
        .returning('id')
        .execute();
      return rows.length;
    },

    async markDeleted(db, productId, adminId) {
      const row = await db
        .updateTable('products')
        .set({ status: 'archived', deleted_at: sql`now()`, deleted_by: adminId })
        .where('id', '=', productId)
        .returning('deleted_at')
        .executeTakeFirstOrThrow();
      return row.deleted_at ?? new Date();
    },

    async findById(db, id, lock = false) {
      let query = baseQuery(db).select(COLUMNS).where('p.id', '=', id);
      if (lock) query = query.forUpdate('p');
      const row = await query.executeTakeFirst();
      return row && toProductRow(row);
    },

    async descriptionOf(db, id) {
      const row = await db
        .selectFrom('product_translations')
        .select('description')
        .where('product_id', '=', id)
        .where('language_code', '=', DEFAULT_LANGUAGE)
        .executeTakeFirst();
      return row?.description ?? null;
    },

    async setDescription(db, id, description) {
      await db
        .insertInto('product_translations')
        .values({ product_id: id, language_code: DEFAULT_LANGUAGE, description })
        .onConflict((oc) =>
          oc
            .columns(['product_id', 'language_code'])
            .doUpdateSet((eb) => ({ description: eb.ref('excluded.description') })),
        )
        .execute();
    },

    async imageAssetIds(db, id) {
      const rows = await db
        .selectFrom('product_images')
        .select('media_asset_id')
        .where('product_id', '=', id)
        .orderBy('sort_order')
        .orderBy('id')
        .execute();
      return rows.map((row) => row.media_asset_id);
    },

    async setImages(db, id, mediaAssetIds) {
      await db.deleteFrom('product_images').where('product_id', '=', id).execute();
      if (mediaAssetIds.length === 0) return;
      await db
        .insertInto('product_images')
        .values(
          mediaAssetIds.map((mediaAssetId, index) => ({
            product_id: id,
            media_asset_id: mediaAssetId,
            sort_order: index + 1,
          })),
        )
        .execute();
    },

    async insert(db, values) {
      try {
        const row = await db
          .insertInto('products')
          .values({
            name: values.name,
            slug: values.slug,
            clothing_type_id: values.clothingTypeId,
            measurement_profile_id: values.measurementProfileId,
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
      const changes = {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.slug !== undefined && { slug: patch.slug }),
        ...(patch.clothingTypeId !== undefined && { clothing_type_id: patch.clothingTypeId }),
        ...(patch.measurementProfileId !== undefined && {
          measurement_profile_id: patch.measurementProfileId,
        }),
        ...(patch.priceMinor !== undefined && { price_minor: patch.priceMinor }),
        ...(patch.searchKeywords !== undefined && { search_keywords: patch.searchKeywords }),
        ...(patch.displayOrder !== undefined && { display_order: patch.displayOrder }),
      };
      if (Object.keys(changes).length === 0) return true;
      try {
        await db.updateTable('products').set(changes).where('id', '=', id).execute();
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
