import type {
  DecisionDto,
  MeasurementMethod,
  SelectionMode,
  SizeRefDto,
} from '@urban-ibile/shared';
import type { SizePick } from './blueprint-engine.js';
import type { DecisionMeasurementRow, DecisionRow } from './blueprint.repository.js';

export function toSizeRef(size: SizePick): SizeRefDto {
  return { id: size.sizeId, code: size.sizeCode, label: size.sizeLabel };
}

export function toDecisionDto(
  row: DecisionRow,
  measurements: readonly DecisionMeasurementRow[],
): DecisionDto {
  return {
    id: row.id,
    product: { id: row.productId, slug: row.productSlug, name: row.productName },
    // CHECK-constrained in the database.
    method: row.method as MeasurementMethod,
    fitPreference: row.fitPreference,
    selectionMode: row.selectionMode as SelectionMode,
    recommendedSize: {
      id: row.recommendedSizeId,
      code: row.recommendedCode,
      label: row.recommendedLabel,
    },
    selectedSize: { id: row.selectedSizeId, code: row.selectedCode, label: row.selectedLabel },
    measurements: measurements.map((m) => ({
      code: m.code,
      label: m.label,
      valueInches: Number(m.valueInches),
      chart: { id: m.chartId, group: m.chartGroup, version: m.chartVersion },
      requiredSize: { id: m.requiredSizeId, code: m.requiredCode, label: m.requiredLabel },
    })),
    bodyScanSessionId: row.bodyScanSessionId,
    chartSnapshot: row.chartSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}
