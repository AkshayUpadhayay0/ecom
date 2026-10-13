import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { MediaAssetStatusRow, MediaAssetsRepository } from './media-assets.repository.js';

const READY_STATUS = 'ready';
/** Catalogue media is shown to everyone; private assets (e.g. return evidence) never are. */
const PUBLIC_VISIBILITY = 'public';

type MediaKind = 'video' | 'image';

export interface MediaAssetsService {
  /** Throws unless `id` is an existing, ready, public, non-retired video asset. */
  assertReadyVideo(db: Database, id: string): Promise<void>;
  /** Same rules for every id, as images. */
  assertReadyImages(db: Database, ids: string[]): Promise<void>;
}

function assertUsable(asset: MediaAssetStatusRow | undefined, kind: MediaKind): void {
  if (!asset || asset.visibility !== PUBLIC_VISIBILITY) {
    // Private assets are reported as missing so their existence is not revealed.
    throw new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, 'Media asset not found.');
  }
  if (asset.kind !== kind) {
    throw new AppError(
      'INVALID_MEDIA_TYPE',
      HTTP_STATUS.BAD_REQUEST,
      `The media asset is not ${kind === 'video' ? 'a video' : 'an image'}.`,
      { mediaAssetId: asset.id, kind: asset.kind },
    );
  }
  if (asset.retiredAt !== null) {
    throw new AppError('INVALID_STATE', HTTP_STATUS.CONFLICT, 'The media asset has been retired.', {
      mediaAssetId: asset.id,
    });
  }
  if (asset.processingStatus !== READY_STATUS) {
    throw new AppError(
      'MEDIA_NOT_READY',
      HTTP_STATUS.CONFLICT,
      'The media asset is not ready yet.',
      {
        mediaAssetId: asset.id,
        processingStatus: asset.processingStatus,
      },
    );
  }
}

export function createMediaAssetsService(repository: MediaAssetsRepository): MediaAssetsService {
  async function assertAll(db: Database, ids: string[], kind: MediaKind): Promise<void> {
    const found = new Map((await repository.findStatuses(db, ids)).map((row) => [row.id, row]));
    for (const id of ids) assertUsable(found.get(id), kind);
  }

  return {
    async assertReadyVideo(db, id) {
      await assertAll(db, [id], 'video');
    },
    async assertReadyImages(db, ids) {
      await assertAll(db, ids, 'image');
    },
  };
}
