import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

/** Product media slots that can hold a pending replacement. */
export type MediaSlot = 'video' | 'images';

export interface PendingMediaRow {
  productId: string;
  slot: MediaSlot;
  /** In display order; exactly one for the video slot. */
  assetIds: string[];
  requestedBy: string;
  createdAt: Date;
}

/**
 * product_pending_media (migration 0011): a replacement for LIVE product media that waits until
 * its new assets are ready. One row per product + slot; a newer request replaces the older one.
 */
export interface PendingMediaRepository {
  upsert(
    db: Database,
    row: { productId: string; slot: MediaSlot; assetIds: string[]; requestedBy: string },
  ): Promise<void>;
  remove(db: Database, productId: string, slot: MediaSlot): Promise<void>;
  forProduct(db: Database, productId: string): Promise<PendingMediaRow[]>;
  /** Product ids with a pending row that contains `assetId` (no lock; used to find candidates). */
  productIdsWithAsset(db: Database, assetId: string): Promise<string[]>;
  /** Locks the product's pending rows. Call AFTER locking the product row (lock order). */
  lockForProduct(db: Database, productId: string): Promise<PendingMediaRow[]>;
}

const COLUMNS = [
  'product_id as productId',
  'slot',
  'asset_ids as assetIds',
  'requested_by as requestedBy',
  'created_at as createdAt',
] as const;

function toRow(row: {
  productId: string;
  slot: string;
  assetIds: string[];
  requestedBy: string;
  createdAt: Date;
}): PendingMediaRow {
  // slot is CHECK-constrained to these values.
  return { ...row, slot: row.slot as MediaSlot };
}

export function createPendingMediaRepository(): PendingMediaRepository {
  return {
    async upsert(db, row) {
      await db
        .insertInto('product_pending_media')
        .values({
          product_id: row.productId,
          slot: row.slot,
          asset_ids: row.assetIds,
          requested_by: row.requestedBy,
        })
        .onConflict((oc) =>
          oc.columns(['product_id', 'slot']).doUpdateSet({
            asset_ids: row.assetIds,
            requested_by: row.requestedBy,
            created_at: sql`now()`,
          }),
        )
        .execute();
    },

    async remove(db, productId, slot) {
      await db
        .deleteFrom('product_pending_media')
        .where('product_id', '=', productId)
        .where('slot', '=', slot)
        .execute();
    },

    async forProduct(db, productId) {
      const rows = await db
        .selectFrom('product_pending_media')
        .select(COLUMNS)
        .where('product_id', '=', productId)
        .execute();
      return rows.map(toRow);
    },

    async productIdsWithAsset(db, assetId) {
      const rows = await db
        .selectFrom('product_pending_media')
        .select('product_id')
        .distinct()
        .where(sql<boolean>`${assetId}::uuid = ANY(asset_ids)`)
        .execute();
      return rows.map((row) => row.product_id);
    },

    async lockForProduct(db, productId) {
      const rows = await db
        .selectFrom('product_pending_media')
        .select(COLUMNS)
        .where('product_id', '=', productId)
        .forUpdate()
        .execute();
      return rows.map(toRow);
    },
  };
}
