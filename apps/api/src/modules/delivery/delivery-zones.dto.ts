import type { DeliveryZoneDto } from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { DeliveryZoneRow } from './delivery-zones.repository.js';

export function toDeliveryZoneDto(row: DeliveryZoneRow): DeliveryZoneDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    feeMinor: row.feeMinor === null ? null : int8ToNumber(row.feeMinor),
    estDaysMin: row.estDaysMin,
    estDaysMax: row.estDaysMax,
    isActive: row.isActive,
    isSampleData: row.isSampleData,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
