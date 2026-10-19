import type { ClothingTypeDto, ProductDto, ProductSummaryDto, SizeDto } from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { ClothingTypeRow } from './clothing-types.repository.js';
import type { ProductRow } from './products.repository.js';
import type { SizeRow } from './sizes.repository.js';

export function toClothingTypeDto(row: ClothingTypeRow): ClothingTypeDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    searchKeywords: row.searchKeywords,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export function toSizeDto(row: SizeRow): SizeDto {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export function toProductSummaryDto(row: ProductRow): ProductSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    clothingType: {
      id: row.clothingTypeId,
      slug: row.clothingTypeSlug,
      name: row.clothingTypeName,
    },
    measurementProfile:
      row.measurementProfileId !== null &&
      row.measurementProfileCode !== null &&
      row.measurementProfileName !== null
        ? {
            id: row.measurementProfileId,
            code: row.measurementProfileCode,
            name: row.measurementProfileName,
          }
        : null,
    priceMinor: int8ToNumber(row.priceMinor),
    currency: row.currency,
    status: row.status,
    displayOrder: row.displayOrder,
    searchKeywords: row.searchKeywords,
    videoAssetId: row.videoAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProductDto(
  row: ProductRow,
  description: string | null,
  imageAssetIds: string[],
  pending: readonly { slot: 'video' | 'images'; assetIds: string[] }[] = [],
): ProductDto {
  const pendingVideo = pending.find((p) => p.slot === 'video');
  const pendingImages = pending.find((p) => p.slot === 'images');
  return {
    ...toProductSummaryDto(row),
    description,
    imageAssetIds,
    pendingMedia: {
      videoAssetId: pendingVideo?.assetIds[0] ?? null,
      imageAssetIds: pendingImages?.assetIds ?? null,
    },
  };
}
