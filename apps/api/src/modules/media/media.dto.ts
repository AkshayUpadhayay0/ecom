import type { MediaAssetDto, MediaRenditionDto } from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { MediaRow, RenditionRow } from './media.repository.js';
import type { StorageProvider } from './storage/storage-provider.js';

/** States in which the original object exists in storage. */
const STORED_STATUSES = new Set(['uploaded', 'processing', 'ready']);

function isPubliclyServable(row: MediaRow): boolean {
  return row.visibility === 'public' && row.purgedAt === null;
}

function toRenditionDto(
  row: RenditionRow,
  servable: boolean,
  storage: StorageProvider,
): MediaRenditionDto {
  return {
    label: row.label,
    format: row.format,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes === null ? null : int8ToNumber(row.sizeBytes),
    // Private media NEVER gets a public URL (signed URLs come from /url endpoints).
    url: servable ? storage.getPublicUrl(row.storageKey) : null,
  };
}

export function toMediaAssetDto(
  row: MediaRow,
  renditions: readonly RenditionRow[],
  storage: StorageProvider,
): MediaAssetDto {
  const servable = isPubliclyServable(row);
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: int8ToNumber(row.sizeBytes),
    visibility: row.visibility,
    status: row.status,
    isTemporary: row.isTemporary,
    originalFilename: row.originalFilename,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    dominantColor: row.dominantColor,
    processingAttempts: row.processingAttempts,
    processingError: row.processingError,
    publicUrl:
      servable && STORED_STATUSES.has(row.status) ? storage.getPublicUrl(row.originalKey) : null,
    renditions: renditions.map((r) => toRenditionDto(r, servable, storage)),
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    purgedAt: row.purgedAt?.toISOString() ?? null,
  };
}
