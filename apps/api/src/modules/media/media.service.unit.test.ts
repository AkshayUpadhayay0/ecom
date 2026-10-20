import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/database.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { MediaUsageRepository } from './media-usage.repository.js';
import type { MediaAssetsRepository } from './media-assets.repository.js';
import type { MediaRepository, MediaRow } from './media.repository.js';
import { createMediaService } from './media.service.js';
import type { StorageProvider } from './storage/storage-provider.js';

/*
 * Customer access to private media is decided by ownership of a return request. Creating a real
 * return request needs orders (Phase 7), so this checks the rule with in-memory doubles.
 */

const OWNER = 'customer-owner';
const ASSET: MediaRow = {
  id: 'asset-1',
  kind: 'image',
  mimeType: 'image/jpeg',
  originalKey: 'media/image/asset-1/original.jpg',
  sizeBytes: '100',
  visibility: 'private',
  status: 'ready',
  isTemporary: false,
  originalFilename: 'evidence.jpg',
  durationMs: null,
  width: 10,
  height: 10,
  dominantColor: null,
  processingAttempts: 1,
  processingError: null,
  uploadExpiresAt: null,
  uploadedAt: new Date(),
  retiredAt: null,
  purgedAt: null,
  createdAt: new Date(),
  // Attached as evidence (not a customer-owned upload) in these cases.
  ownerCustomerId: null,
};

function serviceFor(row: MediaRow) {
  const repository = {
    findById: () => Promise.resolve(row),
    isEvidenceOwnedBy: (_db: Database, _assetId: string, customerId: string) =>
      Promise.resolve(customerId === OWNER),
  } as unknown as MediaRepository; // only the methods this path uses
  const storage = {
    createPrivateSignedUrl: (key: string, ttl: number) =>
      Promise.resolve(`https://signed.example/${key}?ttl=${ttl}`),
    getPublicUrl: () => {
      throw new Error('private media must never get a public URL');
    },
  } as unknown as StorageProvider;
  const settings = { getLimit: () => Promise.resolve(300) } as unknown as SettingsService;
  return createMediaService({
    db: {} as Database,
    repository,
    assets: {} as MediaAssetsRepository,
    usage: {} as MediaUsageRepository,
    storage,
    settings,
    logger: pino({ level: 'silent' }),
  });
}

describe('getUrlForCustomer', () => {
  it('signs a short-lived URL for the owning customer', async () => {
    const result = await serviceFor(ASSET).getUrlForCustomer(OWNER, ASSET.id);
    expect(result.url).toBe('https://signed.example/media/image/asset-1/original.jpg?ttl=300');
    expect(result.expiresAt).not.toBeNull();
  });

  it('answers NOT_FOUND for other customers, public media and purged media', async () => {
    await expect(
      serviceFor(ASSET).getUrlForCustomer('someone-else', ASSET.id),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      serviceFor({ ...ASSET, visibility: 'public' }).getUrlForCustomer(OWNER, ASSET.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      serviceFor({ ...ASSET, retiredAt: new Date(), purgedAt: new Date() }).getUrlForCustomer(
        OWNER,
        ASSET.id,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
