import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { MediaAssetsRepository } from './media-assets.repository.js';

const VIDEO_KIND = 'video';
const READY_STATUS = 'ready';

export interface MediaAssetsService {
  /** Throws unless `id` is an existing video asset whose processing finished (`ready`). */
  assertReadyVideo(db: Database, id: string): Promise<void>;
}

export function createMediaAssetsService(repository: MediaAssetsRepository): MediaAssetsService {
  return {
    async assertReadyVideo(db, id) {
      const asset = await repository.findStatus(db, id);
      if (!asset) {
        throw new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, 'Media asset not found.');
      }
      if (asset.kind !== VIDEO_KIND) {
        throw new AppError(
          'INVALID_MEDIA_TYPE',
          HTTP_STATUS.BAD_REQUEST,
          'The media asset is not a video.',
          {
            kind: asset.kind,
          },
        );
      }
      if (asset.processingStatus !== READY_STATUS) {
        throw new AppError('MEDIA_NOT_READY', HTTP_STATUS.CONFLICT, 'The video is not ready yet.', {
          processingStatus: asset.processingStatus,
        });
      }
    },
  };
}
