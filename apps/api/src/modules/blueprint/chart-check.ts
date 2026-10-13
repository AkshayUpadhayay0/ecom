import type {
  SizeChartCheckDto,
  SizeChartGapDto,
  SizeChartMeasurementCheckDto,
  SizeChartOverlapDto,
} from '@urban-ibile/shared';

export interface CheckCell {
  sizeCode: string;
  sortOrder: number;
  minInches: number;
  maxInches: number;
}

/** Charts store one decimal (numeric(5,1)); compare in tenths to avoid float noise. */
const TENTHS = 10;
const WHOLE_INCH_STEP_TENTHS = 10;

const toTenths = (inches: number): number => Math.round(inches * TENTHS);
const fromTenths = (tenths: number): number => tenths / TENTHS;
const isWholeInch = (tenths: number): boolean => tenths % TENTHS === 0;

/**
 * Compares each size with the next one (by sizes.sort_order) for one measurement. Pure and
 * read-only: it reports what the chart says and never adjusts it.
 */
export function checkMeasurement(
  measurementType: string,
  cells: readonly CheckCell[],
): SizeChartMeasurementCheckDto {
  const ordered = [...cells].sort((a, b) => a.sortOrder - b.sortOrder);
  const gaps: SizeChartGapDto[] = [];
  const overlaps: SizeChartOverlapDto[] = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const lower = ordered[i - 1];
    const upper = ordered[i];
    if (!lower || !upper) continue;
    const lowerMax = toTenths(lower.maxInches);
    const upperMin = toTenths(upper.minInches);
    const upperMax = toTenths(upper.maxInches);

    if (upperMin > lowerMax) {
      gaps.push({
        lowerSize: lower.sizeCode,
        upperSize: upper.sizeCode,
        fromInches: fromTenths(lowerMax),
        toInches: fromTenths(upperMin),
        widthInches: fromTenths(upperMin - lowerMax),
        wholeInchContiguous:
          isWholeInch(lowerMax) &&
          isWholeInch(upperMin) &&
          upperMin - lowerMax === WHOLE_INCH_STEP_TENTHS,
      });
    } else {
      overlaps.push({
        lowerSize: lower.sizeCode,
        upperSize: upper.sizeCode,
        fromInches: fromTenths(upperMin),
        toInches: fromTenths(Math.min(lowerMax, upperMax)),
      });
    }
  }
  return { measurementType, gaps, overlaps };
}

/** Runs the check for every measurement column of a chart. */
export function checkChart(columns: ReadonlyMap<string, readonly CheckCell[]>): SizeChartCheckDto {
  const measurements = [...columns].map(([code, cells]) => checkMeasurement(code, cells));
  return {
    warningCount: measurements.reduce((sum, m) => sum + m.gaps.length + m.overlaps.length, 0),
    measurements,
  };
}
