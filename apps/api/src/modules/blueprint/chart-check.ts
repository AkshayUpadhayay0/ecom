import type { SizeChartCheckDto, SizeChartCheckItemDto } from '@urban-ibile/shared';

/** A size of the chart, in sizes.sort_order. */
export interface CheckSize {
  code: string;
  sortOrder: number;
}

/** One measurement column: max_inches per size code (absent = no cell). */
export interface CheckColumn {
  code: string;
  label: string;
  maxBySize: ReadonlyMap<string, number>;
}

export const UPPER_LIMIT_TEXT =
  'Values above this are out of range. Handling is pending client decision.';

/** Charts store one decimal (numeric(5,1)); compare in tenths to avoid float noise. */
const TENTHS = 10;
const toTenths = (inches: number): number => Math.round(inches * TENTHS);

function inches(value: number): string {
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)} in`;
}

interface SizeMax {
  size: string;
  maxInches: number;
}

/**
 * Checks one measurement against the matching rule SMALLEST_COVERING_SIZE: a value maps to the
 * smallest size whose max_inches >= value, so only max values matter (min is informational).
 * A size whose max does not exceed every smaller size's max can never be recommended.
 * Pure and read-only: reports findings, never adjusts the chart.
 */
export function checkColumn(
  sizes: readonly CheckSize[],
  column: CheckColumn,
): SizeChartCheckItemDto[] {
  const ordered = [...sizes].sort((a, b) => a.sortOrder - b.sortOrder);
  const items: SizeChartCheckItemDto[] = [];
  const base = { measurementType: column.code };

  let leader: SizeMax | undefined; // smallest size holding the highest max so far
  let tie: SizeMax[] = [];
  const flushTie = (): void => {
    const [first] = tie;
    if (first && tie.length > 1) {
      items.push({
        ...base,
        code: 'MAX_TIE',
        severity: 'notice',
        sizes: tie.map((entry) => entry.size),
        values: tie,
        message: `${tie.map((entry) => entry.size).join(', ')} share the same max (${inches(first.maxInches)}): only ${first.size} can be recommended for ${column.label}.`,
      });
    }
    tie = [];
  };

  for (const size of ordered) {
    const maxInches = column.maxBySize.get(size.code);
    if (maxInches === undefined) {
      items.push({
        ...base,
        code: 'MISSING_CELL',
        severity: 'warning',
        sizes: [size.code],
        values: [],
        message: `${size.code} has no value for ${column.label}, so it cannot be matched on this measurement.`,
      });
      continue;
    }
    const current = { size: size.code, maxInches };
    if (!leader || toTenths(maxInches) > toTenths(leader.maxInches)) {
      flushTie();
      leader = current;
      tie = [current];
    } else if (toTenths(maxInches) === toTenths(leader.maxInches)) {
      tie.push(current);
    } else {
      items.push({
        ...base,
        code: 'MAX_NOT_INCREASING',
        severity: 'warning',
        sizes: [leader.size, size.code],
        values: [leader, current],
        message: `${size.code} has a lower max (${inches(maxInches)}) than the smaller size ${leader.size} (${inches(leader.maxInches)}): ${size.code} can never be recommended for ${column.label}.`,
      });
    }
  }
  flushTie();

  if (leader) {
    items.push({
      ...base,
      code: 'UPPER_LIMIT',
      severity: 'info',
      sizes: [leader.size],
      values: [leader],
      message: `Largest max is ${inches(leader.maxInches)} (${leader.size}). ${UPPER_LIMIT_TEXT}`,
    });
  }
  return items;
}

/** Runs the check for every measurement column of a chart. */
export function checkChart(
  sizes: readonly CheckSize[],
  columns: readonly CheckColumn[],
): SizeChartCheckDto {
  const items = columns.flatMap((column) => checkColumn(sizes, column));
  const count = (severity: SizeChartCheckItemDto['severity']) =>
    items.filter((item) => item.severity === severity).length;
  return {
    warningCount: count('warning'),
    noticeCount: count('notice'),
    infoCount: count('info'),
    items,
  };
}
