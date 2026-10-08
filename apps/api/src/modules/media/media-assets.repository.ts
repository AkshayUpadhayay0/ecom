import type { Database } from '../../db/database.js';

export interface MediaAssetStatusRow {
  id: string;
  kind: string;
  processingStatus: string;
}

/**
 * Read-only access used by Phase 2 (assigning existing assets). Uploads and asset creation are
 * Phase 3.
 */
export interface MediaAssetsRepository {
  findStatus(db: Database, id: string): Promise<MediaAssetStatusRow | undefined>;
}

export function createMediaAssetsRepository(): MediaAssetsRepository {
  return {
    async findStatus(db, id) {
      return db
        .selectFrom('media_assets')
        .select(['id', 'kind', 'processing_status as processingStatus'])
        .where('id', '=', id)
        .executeTakeFirst();
    },
  };
}
