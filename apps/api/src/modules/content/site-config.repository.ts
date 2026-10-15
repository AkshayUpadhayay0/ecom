import type { Database } from '../../db/database.js';

export interface HeroRow {
  mediaAssetId: string | null;
  translations: {
    languageCode: string;
    title: string | null;
    body: string | null;
    ctaLabel: string | null;
  }[];
}

export interface ZoneRow {
  code: string;
  name: string;
  feeMinor: string;
  estDaysMin: number | null;
  estDaysMax: number | null;
}

/** Read-only queries for GET /site/config. */
export interface SiteConfigRepository {
  settings(db: Database, keys: readonly string[]): Promise<{ key: string; value: unknown }[]>;
  /** The published content block, or undefined. */
  publishedBlock(db: Database, blockKey: string): Promise<HeroRow | undefined>;
  /** Active zones only; the DB guarantees an active zone has a fee. */
  activeZones(db: Database): Promise<ZoneRow[]>;
  languages(db: Database): Promise<{ code: string; isDefault: boolean }[]>;
}

export function createSiteConfigRepository(): SiteConfigRepository {
  return {
    async settings(db, keys) {
      if (keys.length === 0) return [];
      return db
        .selectFrom('app_settings')
        .select(['setting_key as key', 'value'])
        .where('setting_key', 'in', [...keys])
        .execute();
    },

    async publishedBlock(db, blockKey) {
      const block = await db
        .selectFrom('content_blocks')
        .select(['id', 'media_asset_id as mediaAssetId'])
        .where('block_key', '=', blockKey)
        .where('is_published', '=', true)
        .executeTakeFirst();
      if (!block) return undefined;
      const translations = await db
        .selectFrom('content_block_translations')
        .select(['language_code as languageCode', 'title', 'body', 'cta_label as ctaLabel'])
        .where('content_block_id', '=', block.id)
        .orderBy('language_code')
        .execute();
      return { mediaAssetId: block.mediaAssetId, translations };
    },

    async activeZones(db) {
      const rows = await db
        .selectFrom('delivery_zones')
        .select([
          'code',
          'name',
          'fee_minor as feeMinor',
          'est_days_min as estDaysMin',
          'est_days_max as estDaysMax',
        ])
        .where('is_active', '=', true)
        .where('fee_minor', 'is not', null)
        .orderBy('sort_order')
        .orderBy('name')
        .execute();
      // fee_minor is non-null by the WHERE above (and the DB check on active zones).
      return rows.map((row) => ({ ...row, feeMinor: row.feeMinor ?? '0' }));
    },

    async languages(db) {
      return db
        .selectFrom('languages')
        .select(['code', 'is_default as isDefault'])
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute();
    },
  };
}
