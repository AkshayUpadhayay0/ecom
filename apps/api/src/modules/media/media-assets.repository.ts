import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface MediaAssetStatusRow {
  id: string;
  kind: string;
  processingStatus: string;
  visibility: string;
  retiredAt: Date | null;
  purgedAt: Date | null;
}

/**
 * Read-only access used by Phase 2 (assigning existing assets). Uploads and asset creation are
 * Phase 3.
 */
export interface MediaAssetsRepository {
  /**
   * `lock` = FOR SHARE: a concurrent worker cannot mark these assets ready until the caller's
   * transaction ends, so "not ready -> store a pending replacement" never races the swap.
   */
  findStatuses(db: Database, ids: string[], lock?: boolean): Promise<MediaAssetStatusRow[]>;
  /**
   * Which of `ids` are still used anywhere: product video or images, content blocks (hero),
   * hidden pages, return evidence, or as another asset's poster.
   */
  referencedIds(db: Database, ids: string[]): Promise<Set<string>>;
  /** Sets retired_at on the given assets that are not retired yet; returns those ids. */
  retire(db: Database, ids: string[]): Promise<string[]>;
}

export function createMediaAssetsRepository(): MediaAssetsRepository {
  return {
    async findStatuses(db, ids, lock = false) {
      if (ids.length === 0) return [];
      let query = db
        .selectFrom('media_assets')
        .select([
          'id',
          'kind',
          'processing_status as processingStatus',
          'visibility',
          'retired_at as retiredAt',
          'purged_at as purgedAt',
        ])
        .where('id', 'in', ids);
      if (lock) query = query.forShare();
      return query.execute();
    },

    async referencedIds(db, ids) {
      if (ids.length === 0) return new Set();
      const result = await sql<{ id: string }>`
        SELECT DISTINCT ref.id FROM (
          SELECT video_asset_id AS id FROM products
          UNION ALL SELECT media_asset_id FROM product_images
          UNION ALL SELECT media_asset_id FROM content_blocks
          UNION ALL SELECT media_asset_id FROM qr_pages
          UNION ALL SELECT media_asset_id FROM return_request_media
          UNION ALL SELECT poster_asset_id FROM media_assets
        ) AS ref
        WHERE ref.id = ANY(${ids}::uuid[])`.execute(db);
      return new Set(result.rows.map((row) => row.id));
    },

    async retire(db, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .updateTable('media_assets')
        .set({ retired_at: sql`now()` })
        .where('id', 'in', ids)
        .where('retired_at', 'is', null)
        .returning('id')
        .execute();
      return rows.map((row) => row.id);
    },
  };
}
