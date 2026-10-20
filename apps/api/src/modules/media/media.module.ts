import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { createSettingsRepository } from '../settings/settings.repository.js';
import { createSettingsService } from '../settings/settings.service.js';
import { createMediaUsageRepository } from './media-usage.repository.js';
import { createMediaAssetsRepository } from './media-assets.repository.js';
import { createMediaController, type MediaController } from './media.controller.js';
import { createMediaRepository } from './media.repository.js';
import { createMediaService } from './media.service.js';
import type { StorageProvider } from './storage/storage-provider.js';

export interface MediaModuleDeps {
  db: Database;
  storage: StorageProvider;
  logger: Logger;
}

/** Media controller (admin + customer routes share it). */
export function buildMediaController({ db, storage, logger }: MediaModuleDeps): MediaController {
  return createMediaController(
    createMediaService({
      db,
      repository: createMediaRepository(),
      assets: createMediaAssetsRepository(),
      usage: createMediaUsageRepository(),
      storage,
      settings: createSettingsService({ db, repository: createSettingsRepository() }),
      logger,
    }),
  );
}
