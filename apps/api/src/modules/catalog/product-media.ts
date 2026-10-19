import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { MediaAssetsService } from '../media/media-assets.service.js';
import type { MediaSlot, PendingMediaRepository } from './pending-media.repository.js';
import type { ProductsRepository } from './products.repository.js';

/*
 * Product media placement (decision 19 Oct 2026).
 * - A slot with no LIVE media (new product, or nothing ready yet): attach immediately in any
 *   attachable state (uploaded / processing / ready). The public catalogue shows ready media only.
 * - A slot whose current media is live, replaced by media that is not ready yet: the old media
 *   stays live; the new asset ids are stored as a pending replacement (product_pending_media).
 *   The media worker swaps them in atomically once every asset is ready (old retired, audited).
 * - Media that is already ready always applies immediately and clears any pending replacement.
 */

export interface ProductMediaDeps {
  repository: ProductsRepository;
  pending: PendingMediaRepository;
  media: MediaAssetsService;
}

export type Placement = 'applied' | 'pending';

/** Swaps the slot's references now, retires replaced media nothing uses, drops the pending row. */
async function applyNow(
  deps: ProductMediaDeps,
  trx: Database,
  actor: AuditActor,
  productId: string,
  slot: MediaSlot,
  assetIds: string[],
): Promise<void> {
  if (slot === 'video') {
    const before = (await deps.repository.findById(trx, productId))?.videoAssetId ?? null;
    const [videoId] = assetIds;
    if (videoId === undefined) return;
    await deps.repository.setVideo(trx, productId, videoId);
    // The old video is kept (retired, not deleted) unless something else still uses it.
    if (before !== null && before !== videoId) {
      await deps.media.retireUnreferenced(trx, actor, [before]);
    }
  } else {
    const before = await deps.repository.imageAssetIds(trx, productId);
    await deps.repository.setImages(trx, productId, assetIds);
    await deps.media.retireUnreferenced(
      trx,
      actor,
      before.filter((id) => !assetIds.includes(id)),
    );
  }
  await deps.pending.remove(trx, productId, slot);
}

/** Ids currently attached to the slot. */
async function currentIds(
  deps: ProductMediaDeps,
  trx: Database,
  productId: string,
  slot: MediaSlot,
): Promise<string[]> {
  if (slot === 'images') return deps.repository.imageAssetIds(trx, productId);
  const video = (await deps.repository.findById(trx, productId))?.videoAssetId ?? null;
  return video === null ? [] : [video];
}

/**
 * Admin change of a slot (inside the caller's transaction, product row already locked).
 * Validates the assets, then applies now or stores a pending replacement.
 */
export async function placeProductMedia(
  deps: ProductMediaDeps,
  trx: Database,
  actor: AuditActor,
  productId: string,
  slot: MediaSlot,
  assetIds: string[],
): Promise<Placement> {
  const { allReady } = await deps.media.assertAttachable(
    trx,
    assetIds,
    slot === 'video' ? 'video' : 'image',
  );
  if (!allReady) {
    const current = await currentIds(deps, trx, productId, slot);
    const changed =
      assetIds.length !== current.length || assetIds.some((id, i) => id !== current[i]);
    const hasLiveMedia = (await deps.media.liveIds(trx, current)).size > 0;
    if (changed && hasLiveMedia) {
      await deps.pending.upsert(trx, { productId, slot, assetIds, requestedBy: actor.adminId });
      return 'pending';
    }
  }
  await applyNow(deps, trx, actor, productId, slot, assetIds);
  return 'applied';
}

/**
 * Worker hook (inside the transaction that marked `assetId` ready): applies every pending
 * replacement containing the asset whose assets are now all live. Lock order matches admin
 * writes: product row first, then its pending rows. Audited in the requesting admin's name.
 */
export function createPendingMediaApplier(deps: ProductMediaDeps & { logger: Logger }) {
  return async function onAssetReady(trx: Database, assetId: string): Promise<void> {
    for (const productId of await deps.pending.productIdsWithAsset(trx, assetId)) {
      const product = await deps.repository.findById(trx, productId, true);
      if (!product) continue;
      const rows = await deps.pending.lockForProduct(trx, productId);
      for (const row of rows.filter((r) => r.assetIds.includes(assetId))) {
        const live = await deps.media.liveIds(trx, row.assetIds);
        // Other assets of the replacement are still processing (or failed): keep waiting.
        if (!row.assetIds.every((id) => live.has(id))) continue;
        const actor: AuditActor = { adminId: row.requestedBy, ipAddress: null };
        const before = await currentIds(deps, trx, productId, row.slot);
        await applyNow(deps, trx, actor, productId, row.slot, row.assetIds);
        const field = row.slot === 'video' ? 'videoAssetId' : 'imageAssetIds';
        await writeAuditLog(trx, {
          adminId: row.requestedBy,
          action: row.slot === 'video' ? 'product.video_replace' : 'product.images_replace',
          entityType: 'product',
          entityId: productId,
          before: { [field]: row.slot === 'video' ? (before[0] ?? null) : before },
          after: {
            [field]: row.slot === 'video' ? (row.assetIds[0] ?? null) : row.assetIds,
            appliedBy: 'media_worker',
            requestedAt: row.createdAt.toISOString(),
          },
          ipAddress: null,
        });
        deps.logger.info(
          { productId, slot: row.slot, assetIds: row.assetIds },
          'pending product media applied',
        );
      }
    }
  };
}
