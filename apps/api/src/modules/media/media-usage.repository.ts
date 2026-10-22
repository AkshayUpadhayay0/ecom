import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface MediaUsageRows {
  products: { id: string; name: string; as: 'video' | 'image' }[];
  contentBlocks: { key: string }[];
  pendingReplacements: { productId: string; productName: string; slot: 'video' | 'images' }[];
  hiddenPages: { slotNumber: number }[];
}

/**
 * Where a media asset is used, and detaching it from every place (tester fix 7, 20 Oct 2026).
 * Return evidence is never handled here: private / customer-owned media is refused earlier.
 */
export interface MediaUsageRepository {
  usage(db: Database, assetId: string): Promise<MediaUsageRows>;
  /** "Used by" for a page of the Media Library (batched, no N+1). */
  usageMany(db: Database, assetIds: string[]): Promise<Map<string, MediaUsedBy>>;
  /**
   * Detaches the asset from product videos, product images and content blocks, and cancels
   * pending product replacements that contain it. Returns nothing; call usage() before.
   */
  detachEverywhere(db: Database, assetId: string): Promise<void>;
  /** Sets retired_at (the file stays in storage until a super admin purges it). */
  retire(db: Database, assetId: string): Promise<Date>;
}

export interface MediaUsedBy {
  products: { id: string; name: string; as: 'video' | 'image' }[];
  contentBlocks: { key: string }[];
  pendingReplacements: number;
}

export function createMediaUsageRepository(): MediaUsageRepository {
  return {
    async usageMany(db, assetIds) {
      const result = new Map<string, MediaUsedBy>(
        assetIds.map((id) => [id, { products: [], contentBlocks: [], pendingReplacements: 0 }]),
      );
      if (assetIds.length === 0) return result;
      const [videos, images, blocks, pending] = await Promise.all([
        db
          .selectFrom('products')
          .select(['id', 'name', 'video_asset_id as assetId'])
          .where('video_asset_id', 'in', assetIds)
          .where('deleted_at', 'is', null)
          .orderBy('name')
          .execute(),
        db
          .selectFrom('product_images as pi')
          .innerJoin('products as p', 'p.id', 'pi.product_id')
          .select(['p.id', 'p.name', 'pi.media_asset_id as assetId'])
          .distinct()
          .where('pi.media_asset_id', 'in', assetIds)
          .where('p.deleted_at', 'is', null)
          .orderBy('p.name')
          .execute(),
        db
          .selectFrom('content_blocks')
          .select(['block_key as key', 'media_asset_id as assetId'])
          .where('media_asset_id', 'in', assetIds)
          .execute(),
        sql<{ assetId: string; n: number }>`
          SELECT a.id AS "assetId", count(*)::int AS n
          FROM unnest(${assetIds}::uuid[]) AS a(id)
          JOIN product_pending_media pm ON a.id = ANY(pm.asset_ids)
          GROUP BY a.id`.execute(db),
      ]);
      for (const v of videos) {
        if (v.assetId)
          result.get(v.assetId)?.products.push({ id: v.id, name: v.name, as: 'video' });
      }
      for (const i of images)
        result.get(i.assetId)?.products.push({ id: i.id, name: i.name, as: 'image' });
      for (const b of blocks) {
        if (b.assetId) result.get(b.assetId)?.contentBlocks.push({ key: b.key });
      }
      for (const p of pending.rows) {
        const entry = result.get(p.assetId);
        if (entry) entry.pendingReplacements = p.n;
      }
      return result;
    },

    async usage(db, assetId) {
      const [videoOf, imageOf, blocks, pending, pages] = await Promise.all([
        db
          .selectFrom('products')
          .select(['id', 'name'])
          .where('video_asset_id', '=', assetId)
          .where('deleted_at', 'is', null)
          .orderBy('name')
          .execute(),
        db
          .selectFrom('product_images as pi')
          .innerJoin('products as p', 'p.id', 'pi.product_id')
          .select(['p.id', 'p.name'])
          .distinct()
          .where('pi.media_asset_id', '=', assetId)
          .where('p.deleted_at', 'is', null)
          .orderBy('p.name')
          .execute(),
        db
          .selectFrom('content_blocks')
          .select('block_key as key')
          .where('media_asset_id', '=', assetId)
          .orderBy('block_key')
          .execute(),
        db
          .selectFrom('product_pending_media as pm')
          .innerJoin('products as p', 'p.id', 'pm.product_id')
          .select(['p.id as productId', 'p.name as productName', 'pm.slot'])
          .where(sql<boolean>`${assetId}::uuid = ANY(pm.asset_ids)`)
          .orderBy('p.name')
          .execute(),
        db
          .selectFrom('qr_pages')
          .select('slot_number as slotNumber')
          .where('media_asset_id', '=', assetId)
          .orderBy('slot_number')
          .execute(),
      ]);
      return {
        products: [
          ...videoOf.map((p) => ({ id: p.id, name: p.name, as: 'video' as const })),
          ...imageOf.map((p) => ({ id: p.id, name: p.name, as: 'image' as const })),
        ],
        contentBlocks: blocks,
        // slot is CHECK-constrained to these values.
        pendingReplacements: pending.map((row) => ({
          ...row,
          slot: row.slot as 'video' | 'images',
        })),
        hiddenPages: pages,
      };
    },

    async detachEverywhere(db, assetId) {
      await db
        .updateTable('products')
        .set({ video_asset_id: null })
        .where('video_asset_id', '=', assetId)
        .execute();
      await db.deleteFrom('product_images').where('media_asset_id', '=', assetId).execute();
      await db
        .updateTable('content_blocks')
        .set({ media_asset_id: null })
        .where('media_asset_id', '=', assetId)
        .execute();
      await db
        .deleteFrom('product_pending_media')
        .where(sql<boolean>`${assetId}::uuid = ANY(asset_ids)`)
        .execute();
    },

    async retire(db, assetId) {
      const row = await db
        .updateTable('media_assets')
        .set({ retired_at: sql`coalesce(retired_at, now())` })
        .where('id', '=', assetId)
        .returning('retired_at')
        .executeTakeFirstOrThrow();
      return row.retired_at ?? new Date();
    },
  };
}
