import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';

export interface UsableRendition {
  label: string;
  format: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface UsableMedia {
  id: string;
  kind: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  dominantColor: string | null;
  renditions: UsableRendition[];
}

/**
 * Media the storefront may show: processed (ready), public, not retired, not purged. Anything
 * else is simply absent from the result (callers render no media).
 */
export async function loadUsableMedia(
  db: Database,
  assetIds: readonly (string | null)[],
): Promise<Map<string, UsableMedia>> {
  const ids = [...new Set(assetIds.filter((id): id is string => id !== null))];
  const result = new Map<string, UsableMedia>();
  if (ids.length === 0) return result;
  const assets = await db
    .selectFrom('media_assets')
    .select([
      'id',
      'kind',
      'width',
      'height',
      'duration_ms as durationMs',
      'dominant_color as dominantColor',
    ])
    .where('id', 'in', ids)
    .where('processing_status', '=', 'ready')
    .where('visibility', '=', 'public')
    .where('retired_at', 'is', null)
    .where('purged_at', 'is', null)
    .execute();
  for (const asset of assets) result.set(asset.id, { ...asset, renditions: [] });
  if (result.size === 0) return result;
  const renditions = await db
    .selectFrom('media_renditions')
    .select([
      'asset_id as assetId',
      'label',
      'format',
      'storage_key as storageKey',
      'width',
      'height',
      'size_bytes as sizeBytes',
    ])
    .where('asset_id', 'in', [...result.keys()])
    .orderBy('height')
    .orderBy('width')
    .execute();
  for (const { assetId, sizeBytes, ...rendition } of renditions) {
    result.get(assetId)?.renditions.push({
      ...rendition,
      sizeBytes: sizeBytes === null ? null : int8ToNumber(sizeBytes),
    });
  }
  return result;
}
