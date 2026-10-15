import { sql, type ExpressionBuilder } from 'kysely';
import type { CatalogSort } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import type { DB } from '../../db/types.js';
import { escapeLike } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

/** The default language, read from data (never hard-coded). */
const DEFAULT_LANGUAGE = sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`;
const ACTIVE = 'active';

export interface CardRow {
  id: string;
  slug: string;
  name: string;
  clothingTypeSlug: string;
  clothingTypeName: string | null;
  priceMinor: string;
  currency: string;
  videoAssetId: string | null;
  inStock: boolean;
}

export interface DetailRow extends CardRow {
  description: string | null;
  measurementProfileId: string | null;
  profileCode: string | null;
  profileName: string | null;
}

export interface SizeRow {
  sizeCode: string;
  label: string;
  available: number;
  lowStockThreshold: number;
}

export interface MeasurementRow {
  code: string;
  label: string;
  helpText: string | null;
}

export interface CatalogFilters {
  clothingTypeSlug?: string | undefined;
  /** Raw search text; escaped here and matched with ILIKE (trigram indexes). */
  search?: string | undefined;
  sort: CatalogSort;
}

/** EXISTS comes back as a SQL boolean; normalise for the DTO. */
function withBooleanStock<T extends { inStock: unknown }>(row: T): T & { inStock: boolean } {
  return { ...row, inStock: row.inStock === true || row.inStock === 1 };
}

type ProductScope = ExpressionBuilder<DB & { p: DB['products'] }, 'p'>;

/** A product is sellable when it has at least one active variant in an active size. */
function hasActiveVariant(eb: ProductScope, inStockOnly = false) {
  let sub = eb
    .selectFrom('product_variants as v')
    .innerJoin('sizes as s', 's.id', 'v.size_id')
    .select(sql<number>`1`.as('one'))
    .whereRef('v.product_id', '=', 'p.id')
    .where('v.is_active', '=', true)
    .where('s.is_active', '=', true);
  if (inStockOnly) sub = sub.where(sql<boolean>`v.stock_on_hand - v.stock_reserved > 0`);
  return eb.exists(sub);
}

function cardQuery(db: Database) {
  return db
    .selectFrom('products as p')
    .innerJoin('clothing_types as ct', 'ct.id', 'p.clothing_type_id')
    .leftJoin('clothing_type_translations as ctt', (join) =>
      join
        .onRef('ctt.clothing_type_id', '=', 'ct.id')
        .on('ctt.language_code', '=', DEFAULT_LANGUAGE),
    )
    .where('p.status', '=', ACTIVE)
    .where((eb) => hasActiveVariant(eb));
}

const CARD_COLUMNS = [
  'p.id',
  'p.slug',
  'p.name',
  'ct.slug as clothingTypeSlug',
  'ctt.name as clothingTypeName',
  'p.price_minor as priceMinor',
  'p.currency',
  'p.video_asset_id as videoAssetId',
] as const;

/** Read-only queries for the public storefront. Never selects stock counts beyond a flag. */
export interface PublicCatalogRepository {
  listCards(
    db: Database,
    filters: CatalogFilters,
    page: PageRequest,
  ): Promise<{ rows: CardRow[]; total: number }>;
  findProduct(db: Database, ref: { id?: string; slug?: string }): Promise<DetailRow | undefined>;
  /** Active variants in active sizes, by size order. */
  sizesFor(db: Database, productId: string): Promise<SizeRow[]>;
  imageAssetIds(db: Database, productId: string): Promise<string[]>;
  profileMeasurements(db: Database, profileId: string): Promise<MeasurementRow[]>;
  listClothingTypes(db: Database): Promise<{ slug: string; name: string | null }[]>;
}

export function createPublicCatalogRepository(): PublicCatalogRepository {
  return {
    async listCards(db, filters, page) {
      let query = cardQuery(db);
      if (filters.clothingTypeSlug !== undefined) {
        query = query.where('ct.slug', '=', filters.clothingTypeSlug);
      }
      if (filters.search !== undefined) {
        const pattern = `%${escapeLike(filters.search)}%`;
        query = query.where((eb) =>
          eb.or([
            eb('p.name', 'ilike', pattern),
            eb('p.search_keywords', 'ilike', pattern),
            eb('ct.search_keywords', 'ilike', pattern),
            eb.exists(
              eb
                .selectFrom('clothing_type_translations as t')
                .select(sql<number>`1`.as('one'))
                .whereRef('t.clothing_type_id', '=', 'ct.id')
                .where('t.name', 'ilike', pattern),
            ),
          ]),
        );
      }
      let ordered = query.select((eb) => [
        ...CARD_COLUMNS,
        hasActiveVariant(eb, true).as('inStock'),
      ]);
      switch (filters.sort) {
        case 'price_asc':
          ordered = ordered.orderBy('p.price_minor', 'asc').orderBy('p.id', 'asc');
          break;
        case 'price_desc':
          ordered = ordered.orderBy('p.price_minor', 'desc').orderBy('p.id', 'desc');
          break;
        case 'name':
          ordered = ordered.orderBy('p.name', 'asc').orderBy('p.id', 'asc');
          break;
        case 'newest':
          ordered = ordered.orderBy('p.created_at', 'desc').orderBy('p.id', 'asc');
          break;
      }
      const [rows, count] = await Promise.all([
        ordered.limit(page.pageSize).offset(page.offset).execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows: rows.map(withBooleanStock), total: Number(count.total) };
    },

    async findProduct(db, ref) {
      let query = cardQuery(db)
        .leftJoin('measurement_profiles as mp', (join) =>
          join.onRef('mp.id', '=', 'p.measurement_profile_id').on('mp.is_active', '=', true),
        )
        .leftJoin('product_translations as pt', (join) =>
          join.onRef('pt.product_id', '=', 'p.id').on('pt.language_code', '=', DEFAULT_LANGUAGE),
        )
        .select((eb) => [
          ...CARD_COLUMNS,
          hasActiveVariant(eb, true).as('inStock'),
          'pt.description',
          'mp.id as measurementProfileId',
          'mp.code as profileCode',
          'mp.name as profileName',
        ]);
      if (ref.id !== undefined) query = query.where('p.id', '=', ref.id);
      if (ref.slug !== undefined) query = query.where('p.slug', '=', ref.slug);
      const row = await query.executeTakeFirst();
      return row && withBooleanStock(row);
    },

    async sizesFor(db, productId) {
      const rows = await db
        .selectFrom('product_variants as v')
        .innerJoin('sizes as s', 's.id', 'v.size_id')
        .select([
          's.code as sizeCode',
          's.label',
          sql<number>`v.stock_on_hand - v.stock_reserved`.as('available'),
          'v.low_stock_threshold as lowStockThreshold',
        ])
        .where('v.product_id', '=', productId)
        .where('v.is_active', '=', true)
        .where('s.is_active', '=', true)
        .orderBy('s.sort_order')
        .orderBy('s.code')
        .execute();
      return rows;
    },

    async imageAssetIds(db, productId) {
      const rows = await db
        .selectFrom('product_images')
        .select('media_asset_id')
        .where('product_id', '=', productId)
        .orderBy('sort_order')
        .orderBy('id')
        .execute();
      return rows.map((row) => row.media_asset_id);
    },

    async profileMeasurements(db, profileId) {
      return db
        .selectFrom('measurement_profile_items as i')
        .innerJoin('measurement_types as m', 'm.id', 'i.measurement_type_id')
        .select(['m.code', 'm.label', 'm.help_text as helpText'])
        .where('i.profile_id', '=', profileId)
        .where('m.is_active', '=', true)
        .orderBy('i.sort_order')
        .execute();
    },

    async listClothingTypes(db) {
      return db
        .selectFrom('clothing_types as ct')
        .leftJoin('clothing_type_translations as t', (join) =>
          join
            .onRef('t.clothing_type_id', '=', 'ct.id')
            .on('t.language_code', '=', DEFAULT_LANGUAGE),
        )
        .select(['ct.slug', 't.name'])
        .where('ct.is_active', '=', true)
        .orderBy('ct.sort_order')
        .orderBy('ct.slug')
        .execute();
    },
  };
}
