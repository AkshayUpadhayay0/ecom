/**
 * Blueprint size engine (pure, no I/O). Confirmed rules (9 Oct design):
 * 1. Each required measurement maps to the SMALLEST size (by sizes.sort_order) whose max_inches
 *    covers the value (boundary rule SMALLEST_COVERING_SIZE). Only max_inches decides.
 * 2. The outfit's size is the LARGEST of those per-measurement sizes (a two-piece set is one size).
 * 3. Fit preference is not an input here: it never changes the size.
 * Everything (measurements, sizes, values) comes from the caller's data; nothing is hard-coded.
 */

/**
 * What happens when a measurement is outside the chart. PENDING CLIENT DECISION: today the only
 * policy is to refuse (no size is guessed, the largest size is never auto-picked). The client's
 * final handling plugs in here.
 */
export const OUT_OF_RANGE_POLICY = 'REJECT' as const;

export interface ChartRowInput {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sortOrder: number;
  minInches: number;
  maxInches: number;
}

/** One required measurement with the active chart rows for it. */
export interface EngineItem {
  measurementCode: string;
  label: string;
  chartId: string;
  chartGroup: string;
  chartVersion: number;
  rows: readonly ChartRowInput[];
}

export interface EngineInput {
  items: readonly EngineItem[];
  /** Inches by measurement code (already validated: present, positive, sane). */
  values: ReadonlyMap<string, number>;
  /** PENDING CLIENT DECISION (setting blueprint.reject_below_chart_min). */
  rejectBelowChartMin: boolean;
}

export interface SizePick {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sortOrder: number;
}

export interface BreakdownEntry {
  measurementCode: string;
  label: string;
  valueInches: number;
  chartId: string;
  chartGroup: string;
  chartVersion: number;
  required: SizePick;
}

export interface OutOfRangeEntry {
  measurementCode: string;
  label: string;
  valueInches: number;
  /** Covered range of the chart for this measurement. */
  chartMinInches: number;
  chartMaxInches: number;
  side: 'above' | 'below';
}

export type EngineResult =
  | { ok: true; recommended: SizePick; breakdown: BreakdownEntry[] }
  | { ok: false; outOfRange: OutOfRangeEntry[] };

/** Charts and inputs have one decimal; compare in tenths to avoid float noise. */
const TENTHS = 10;
const tenths = (inches: number): number => Math.round(inches * TENTHS);

function pick(row: ChartRowInput): SizePick {
  return {
    sizeId: row.sizeId,
    sizeCode: row.sizeCode,
    sizeLabel: row.sizeLabel,
    sortOrder: row.sortOrder,
  };
}

export function recommendSize(input: EngineInput): EngineResult {
  const breakdown: BreakdownEntry[] = [];
  const outOfRange: OutOfRangeEntry[] = [];

  for (const item of input.items) {
    const value = input.values.get(item.measurementCode);
    if (value === undefined) throw new Error(`Missing value for ${item.measurementCode}`);
    const rows = [...item.rows].sort((a, b) => a.sortOrder - b.sortOrder);
    if (rows.length === 0)
      throw new Error(`Chart ${item.chartId} has no rows for ${item.measurementCode}`);
    const chartMax = Math.max(...rows.map((r) => r.maxInches));
    const chartMin = Math.min(...rows.map((r) => r.minInches));
    const range = {
      measurementCode: item.measurementCode,
      label: item.label,
      valueInches: value,
      chartMinInches: chartMin,
      chartMaxInches: chartMax,
    };

    const covering = rows.find((row) => tenths(row.maxInches) >= tenths(value));
    if (!covering) {
      outOfRange.push({ ...range, side: 'above' });
      continue;
    }
    if (input.rejectBelowChartMin && tenths(value) < tenths(chartMin)) {
      outOfRange.push({ ...range, side: 'below' });
      continue;
    }
    breakdown.push({
      measurementCode: item.measurementCode,
      label: item.label,
      valueInches: value,
      chartId: item.chartId,
      chartGroup: item.chartGroup,
      chartVersion: item.chartVersion,
      required: pick(covering),
    });
  }

  if (outOfRange.length > 0) return { ok: false, outOfRange };
  const [first, ...rest] = breakdown;
  if (!first) throw new Error('No measurements to evaluate');
  const recommended = rest.reduce(
    (largest, entry) => (entry.required.sortOrder > largest.sortOrder ? entry.required : largest),
    first.required,
  );
  return { ok: true, recommended, breakdown };
}
