import type { MediaAssetDto } from '@urban-ibile/shared';
import { catalogApi, putToStorage } from '@/lib/api/catalog';

/** How often a file that is still uploading / processing is re-checked. */
export const MEDIA_POLL_MS = 3000;
export const VIDEO_TYPES = 'video/mp4,video/quicktime,video/webm';
export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
/** Asset statuses that will still change on their own (keep polling). */
export const STILL_WORKING = new Set(['pending', 'uploaded', 'processing']);

/**
 * Uploads one PUBLIC file (product / site media): create the asset, PUT the bytes straight to
 * storage with the presigned URL (the API never proxies files), then verify and queue processing.
 */
export async function uploadPublicFile(file: File): Promise<MediaAssetDto> {
  const created = await catalogApi.createUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    visibility: 'public',
    isTemporary: false,
  });
  await putToStorage(created.upload, file);
  return catalogApi.completeUpload(created.asset.id);
}
