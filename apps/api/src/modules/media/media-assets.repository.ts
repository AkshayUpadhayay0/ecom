import type { Database } from '../../db/database.js';

export interface MediaAssetStatusRow {
  id: string;
  kind: string;
  processingStatus: string;
  visibility: string;
  retiredAt: Date | null;
}

/**
 * Read-only access used by Phase 2 (assigning existing assets). Uploads and asset creation are
 * Phase 3.
 */
export interface MediaAssetsRepository {
  findStatuses(db: Database, ids: string[]): Promise<MediaAssetStatusRow[]>;
}

export function createMediaAssetsRepository(): MediaAssetsRepository {
  return {
    async findStatuses(db, ids) {
      if (ids.length === 0) return [];
      return db
        .selectFrom('media_assets')
        .select([
          'id',
          'kind',
          'processing_status as processingStatus',
          'visibility',
          'retired_at as retiredAt',
        ])
        .where('id', 'in', ids)
        .execute();
    },
  };
}
