import type { SizeChartDto, SizeChartStatus } from '@urban-ibile/shared';
import type { BadgeTone } from '@/components/ui/badge';

export type WarningKind = 'gap' | 'overlap';

/** One review warning from the API's chart check, flattened for display. */
export interface ChartWarning {
  id: string;
  kind: WarningKind;
  measurementCode: string;
  measurementLabel: string;
  lowerSize: string;
  upperSize: string;
  fromInches: number;
  toInches: number;
  /** Gaps only. */
  widthInches?: number;
  /** Gaps only: the two ranges touch when the chart is read in whole inches. */
  wholeInchContiguous?: boolean;
}

/** "38" or "17.5": charts store one decimal; whole inches drop it. */
export function formatInches(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "38 – 40 in", or "33 in" when the chart gives a single point. */
export function formatRange(minInches: number, maxInches: number): string {
  return minInches === maxInches
    ? `${formatInches(minInches)} in`
    : `${formatInches(minInches)} – ${formatInches(maxInches)} in`;
}

export function cellKey(sizeCode: string, measurementCode: string): string {
  return `${sizeCode}|${measurementCode}`;
}

/** DOM id of a grid cell (scroll target). */
export function cellDomId(sizeCode: string, measurementCode: string): string {
  return `chart-cell-${sizeCode}-${measurementCode}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function buildWarnings(chart: SizeChartDto): ChartWarning[] {
  const labels = new Map(chart.measurementTypes.map((m) => [m.code, m.label]));
  const warnings: ChartWarning[] = [];
  for (const measurement of chart.check.measurements) {
    const label = labels.get(measurement.measurementType) ?? measurement.measurementType;
    measurement.gaps.forEach((gap, index) => {
      warnings.push({
        id: `gap-${measurement.measurementType}-${index}`,
        kind: 'gap',
        measurementCode: measurement.measurementType,
        measurementLabel: label,
        lowerSize: gap.lowerSize,
        upperSize: gap.upperSize,
        fromInches: gap.fromInches,
        toInches: gap.toInches,
        widthInches: gap.widthInches,
        wholeInchContiguous: gap.wholeInchContiguous,
      });
    });
    measurement.overlaps.forEach((overlap, index) => {
      warnings.push({
        id: `overlap-${measurement.measurementType}-${index}`,
        kind: 'overlap',
        measurementCode: measurement.measurementType,
        measurementLabel: label,
        lowerSize: overlap.lowerSize,
        upperSize: overlap.upperSize,
        fromInches: overlap.fromInches,
        toInches: overlap.toInches,
      });
    });
  }
  return warnings;
}

/** Which warning kinds touch each cell (both sizes of a pair are involved). */
export function warningsByCell(warnings: readonly ChartWarning[]): Map<string, Set<WarningKind>> {
  const byCell = new Map<string, Set<WarningKind>>();
  for (const warning of warnings) {
    for (const size of [warning.lowerSize, warning.upperSize]) {
      const key = cellKey(size, warning.measurementCode);
      const kinds = byCell.get(key) ?? new Set<WarningKind>();
      kinds.add(warning.kind);
      byCell.set(key, kinds);
    }
  }
  return byCell;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "3 gaps, 5 overlaps" */
export function warningSummary(warnings: readonly ChartWarning[]): string {
  const gaps = warnings.filter((w) => w.kind === 'gap').length;
  return `${plural(gaps, 'gap')}, ${plural(warnings.length - gaps, 'overlap')}`;
}

/** One sentence describing a warning (list text and screen readers). */
export function describeWarning(warning: ChartWarning): string {
  const sizes = `${warning.lowerSize} and ${warning.upperSize}`;
  if (warning.kind === 'overlap') {
    return `${warning.measurementLabel}: ${sizes} overlap at ${formatRange(warning.fromInches, warning.toInches)}`;
  }
  const width =
    warning.widthInches === undefined ? '' : ` (${formatInches(warning.widthInches)} in wide)`;
  return `${warning.measurementLabel}: gap between ${sizes}, nothing covers ${formatInches(warning.fromInches)} – ${formatInches(warning.toInches)} in${width}`;
}

export const CHART_STATUS_DISPLAY: Record<SizeChartStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  draft: { label: 'Draft', tone: 'info' },
  retired: { label: 'Retired', tone: 'neutral' },
};
