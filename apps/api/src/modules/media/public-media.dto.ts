import type { PublicGridMediaDto, PublicImageDto, PublicVideoDto } from '@urban-ibile/shared';
import type { UsableMedia, UsableRendition } from './public-media.repository.js';
import type { StorageProvider } from './storage/storage-provider.js';

/** Rendition labels shown on product cards (the detail page gets every size). */
export const GRID_VIDEO_LABELS = ['480p', '720p'] as const;
const POSTER_LABEL = 'poster';
const PREVIEW_LABEL = 'preview';
const MP4 = 'mp4';
const WEBP = 'webp';

function urlOf(storage: StorageProvider, rendition: UsableRendition | undefined): string | null {
  return rendition ? storage.getPublicUrl(rendition.storageKey) : null;
}

function videoSources(storage: StorageProvider, media: UsableMedia, labels?: readonly string[]) {
  return media.renditions
    .filter((r) => r.format === MP4 && r.label !== PREVIEW_LABEL)
    .filter((r) => labels === undefined || labels.includes(r.label))
    .map((r) => ({
      label: r.label,
      url: storage.getPublicUrl(r.storageKey),
      width: r.width,
      height: r.height,
    }));
}

/** Product card: poster, muted loop and the 480p/720p MP4s. */
export function toGridMedia(storage: StorageProvider, media: UsableMedia): PublicGridMediaDto {
  return {
    posterUrl: urlOf(
      storage,
      media.renditions.find((r) => r.label === POSTER_LABEL),
    ),
    previewUrl: urlOf(
      storage,
      media.renditions.find((r) => r.label === PREVIEW_LABEL && r.format === MP4),
    ),
    mp4: videoSources(storage, media, GRID_VIDEO_LABELS),
    dominantColor: media.dominantColor,
  };
}

/** Detail / hero video: every MP4 size plus poster and loop. */
export function toVideo(storage: StorageProvider, media: UsableMedia): PublicVideoDto {
  return {
    ...toGridMedia(storage, media),
    mp4: videoSources(storage, media),
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
  };
}

export function toImage(storage: StorageProvider, media: UsableMedia): PublicImageDto {
  return {
    dominantColor: media.dominantColor,
    width: media.width,
    height: media.height,
    variants: media.renditions
      .filter((r) => r.format === WEBP)
      .map((r) => ({ width: r.width, height: r.height, url: storage.getPublicUrl(r.storageKey) })),
  };
}
