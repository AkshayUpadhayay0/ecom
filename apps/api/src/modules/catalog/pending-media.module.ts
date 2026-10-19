import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { createMediaAssetsRepository } from '../media/media-assets.repository.js';
import { createMediaAssetsService } from '../media/media-assets.service.js';
import { createPendingMediaRepository } from './pending-media.repository.js';
import { createPendingMediaApplier } from './product-media.js';
import { createProductsRepository } from './products.repository.js';

/** The media worker's "asset is ready" hook: applies pending product media replacements. */
export function buildPendingMediaApplier(
  logger: Logger,
): (trx: Database, assetId: string) => Promise<void> {
  return createPendingMediaApplier({
    repository: createProductsRepository(),
    pending: createPendingMediaRepository(),
    media: createMediaAssetsService(createMediaAssetsRepository()),
    logger,
  });
}
