import type {
  LowStockVariantDto,
  StockMovementDto,
  StockMovementType,
  VariantDto,
} from '@urban-ibile/shared';
import type { LowStockRow, StockMovementRow, VariantRow } from './variants.repository.js';

export function toVariantDto(row: VariantRow): VariantDto {
  const stockAvailable = row.stockOnHand - row.stockReserved;
  return {
    id: row.id,
    productId: row.productId,
    size: { id: row.sizeId, code: row.sizeCode, label: row.sizeLabel },
    sku: row.sku,
    stockOnHand: row.stockOnHand,
    stockReserved: row.stockReserved,
    stockAvailable,
    lowStockThreshold: row.lowStockThreshold,
    isLowStock: stockAvailable <= row.lowStockThreshold,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toLowStockVariantDto(row: LowStockRow): LowStockVariantDto {
  return {
    ...toVariantDto(row),
    product: {
      id: row.productId,
      name: row.productName,
      slug: row.productSlug,
      status: row.productStatus,
    },
  };
}

export function toStockMovementDto(row: StockMovementRow): StockMovementDto {
  return {
    id: row.id,
    variantId: row.variantId,
    // movement_type is CHECK-constrained to the StockMovementType values.
    type: row.type as StockMovementType,
    quantityDelta: row.quantityDelta,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    note: row.note,
    admin:
      row.adminId !== null ? { id: row.adminId, displayName: row.adminDisplayName ?? '' } : null,
    createdAt: row.createdAt.toISOString(),
  };
}
