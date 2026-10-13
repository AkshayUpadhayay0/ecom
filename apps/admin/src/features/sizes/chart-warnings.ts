import type {
  SizeChartCheckCode,
  SizeChartCheckItemDto,
  SizeChartCheckSeverity,
  SizeChartDto,
  SizeChartStatus,
} from '@urban-ibile/shared';
import type { BadgeTone } from '@/components/ui/badge';

/** One finding of the API's chart check, with a stable id for the UI. */
export interface ChartFinding extends SizeChartCheckItemDto {
  id: string;
  measurementLabel: string;
}

export const EXPLANATION =
  'Each measurement is matched to the smallest size whose max is large enough. These checks are for review with the tailor. Nothing has been changed.';

/** Short label shown next to the icon (cells and list), so meaning never relies on colour. */
export const CODE_LABEL: Record<SizeChartCheckCode, string> = {
  MAX_NOT_INCREASING: 'Max not increasing',
  MAX_TIE: 'Same max',
  MISSING_CELL: 'Missing value',
  UPPER_LIMIT: 'Upper limit',
};

export const SEVERITY_LABEL: Record<SizeChartCheckSeverity, string> = {
  warning: 'Warning',
  notice: 'Notice',
  info: 'Info',
};

/** "38" or "17.5": charts store one decimal; whole inches drop it. */
export function formatInches(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "38 – 40 in", or "33 in" when min and max are the same. */
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

export function buildFindings(chart: SizeChartDto): ChartFinding[] {
  const labels = new Map(chart.measurementTypes.map((m) => [m.code, m.label]));
  return chart.check.items.map((item, index) => ({
    ...item,
    id: `${item.code}-${item.measurementType}-${index}`,
    measurementLabel: labels.get(item.measurementType) ?? item.measurementType,
  }));
}

/** True for findings that highlight cells and count in the summary (info items do neither). */
export function isCounted(finding: SizeChartCheckItemDto): boolean {
  return finding.severity !== 'info';
}

/** Codes of the warnings/notices touching each cell. Normal cells are absent. */
export function findingsByCell(
  findings: readonly ChartFinding[],
): Map<string, Set<SizeChartCheckCode>> {
  const byCell = new Map<string, Set<SizeChartCheckCode>>();
  for (const finding of findings) {
    if (!isCounted(finding)) continue;
    for (const size of finding.sizes) {
      const key = cellKey(size, finding.measurementType);
      const codes = byCell.get(key) ?? new Set<SizeChartCheckCode>();
      codes.add(finding.code);
      byCell.set(key, codes);
    }
  }
  return byCell;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "2 warnings, 3 notices" (info items are not counted). */
export function findingSummary(check: SizeChartDto['check']): string {
  return `${plural(check.warningCount, 'warning')}, ${plural(check.noticeCount, 'notice')}`;
}

export const CHART_STATUS_DISPLAY: Record<SizeChartStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  draft: { label: 'Draft', tone: 'info' },
  retired: { label: 'Retired', tone: 'neutral' },
};
