import { PUBLIC_SETTING_KEYS, type PublicSiteConfigDto } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { toVideo } from '../media/public-media.dto.js';
import { loadUsableMedia } from '../media/public-media.repository.js';
import type { StorageProvider } from '../media/storage/storage-provider.js';
import type { SiteConfigRepository } from './site-config.repository.js';

/** Content block holding the storefront hero (video + copy). */
export const HERO_BLOCK_KEY = 'home.hero';

export interface SiteConfigService {
  /** Public settings (explicit allow-list), hero, active delivery zones, languages. */
  get(): Promise<PublicSiteConfigDto>;
}

export interface SiteConfigServiceDeps {
  db: Database;
  repository: SiteConfigRepository;
  storage: StorageProvider;
}

export function createSiteConfigService({
  db,
  repository,
  storage,
}: SiteConfigServiceDeps): SiteConfigService {
  return {
    async get() {
      const [settingRows, hero, zones, languages] = await Promise.all([
        repository.settings(db, PUBLIC_SETTING_KEYS),
        repository.publishedBlock(db, HERO_BLOCK_KEY),
        repository.activeZones(db),
        repository.languages(db),
      ]);
      const stored = new Map(settingRows.map((row) => [row.key, row.value]));
      // Every allow-listed key is present; NULL means "not provided yet".
      const settings = Object.fromEntries(
        PUBLIC_SETTING_KEYS.map((key) => [key, stored.get(key) ?? null]),
      );
      const media = await loadUsableMedia(db, [hero?.mediaAssetId ?? null]);
      const heroVideo = hero?.mediaAssetId ? media.get(hero.mediaAssetId) : undefined;
      const defaultLanguage = languages.find((l) => l.isDefault)?.code ?? languages[0]?.code ?? '';

      return {
        settings,
        hero: hero
          ? {
              video: heroVideo?.kind === 'video' ? toVideo(storage, heroVideo) : null,
              translations: Object.fromEntries(
                hero.translations.map(({ languageCode, ...copy }) => [languageCode, copy]),
              ),
            }
          : null,
        deliveryZones: zones.map((zone) => ({
          code: zone.code,
          name: zone.name,
          feeMinor: int8ToNumber(zone.feeMinor),
          estDaysMin: zone.estDaysMin,
          estDaysMax: zone.estDaysMax,
        })),
        defaultLanguage,
        languages: languages.map((language) => language.code),
      };
    },
  };
}
