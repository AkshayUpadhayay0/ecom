import type {
  ClothingTypeDto,
  GarmentCutDto,
  ProductDto,
  ProductSummaryDto,
  SizeDto,
} from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { ClothingTypeRow } from './clothing-types.repository.js';
import type { GarmentCutRow } from './garment-cuts.repository.js';
import type { ProductRow } from './products.repository.js';
import type { SizeRow } from './sizes.repository.js';

export function toClothingTypeDto(row: ClothingTypeRow): ClothingTypeDto {
  return {
    id: row.id,
    slug: row.slug,
    searchKeywords: row.searchKeywords,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    translations: Object.fromEntries(
      Object.entries(row.names).map(([code, name]) => [code, { name }]),
    ),
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

export function toGarmentCutDto(row: GarmentCutRow): GarmentCutDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
    garmentCut:
      row.garmentCutId !== null && row.garmentCutCode !== null && row.garmentCutName !== null
        ? { id: row.garmentCutId, code: row.garmentCutCode, name: row.garmentCutName }
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

export function toProductDto(row: ProductRow, descriptions: Record<string, string>): ProductDto {
  return {
    ...toProductSummaryDto(row),
    translations: Object.fromEntries(
      Object.entries(descriptions).map(([code, description]) => [code, { description }]),
    ),
  };
}
