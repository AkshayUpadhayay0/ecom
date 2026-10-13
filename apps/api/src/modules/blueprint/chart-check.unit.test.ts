import { describe, expect, it } from 'vitest';
import { checkChart, checkMeasurement, type CheckCell } from './chart-check.js';

const cell = (
  sizeCode: string,
  sortOrder: number,
  minInches: number,
  maxInches: number,
): CheckCell => ({ sizeCode, sortOrder, minInches, maxInches });

describe('checkMeasurement', () => {
  it('reports gaps with their width and flags whole-inch neighbours', () => {
    const result = checkMeasurement('chest', [
      cell('L', 2, 41, 43),
      cell('M', 1, 38, 40), // out of order on purpose: sorting uses sort_order
      cell('XL', 3, 45.5, 46),
    ]);
    expect(result.overlaps).toEqual([]);
    expect(result.gaps).toEqual([
      {
        lowerSize: 'M',
        upperSize: 'L',
        fromInches: 40,
        toInches: 41,
        widthInches: 1,
        wholeInchContiguous: true,
      },
      {
        lowerSize: 'L',
        upperSize: 'XL',
        fromInches: 43,
        toInches: 45.5,
        widthInches: 2.5,
        wholeInchContiguous: false,
      },
    ]);
  });

  it('reports touching, partial and identical ranges as overlaps', () => {
    const result = checkMeasurement('sleeve', [
      cell('M', 1, 24, 25),
      cell('L', 2, 25, 26),
      cell('XL', 3, 25, 26),
      cell('XXL', 4, 25.5, 27),
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.overlaps).toEqual([
      { lowerSize: 'M', upperSize: 'L', fromInches: 25, toInches: 25 },
      { lowerSize: 'L', upperSize: 'XL', fromInches: 25, toInches: 26 },
      { lowerSize: 'XL', upperSize: 'XXL', fromInches: 25.5, toInches: 26 },
    ]);
  });

  it('avoids float noise on one-decimal values and counts warnings per chart', () => {
    const check = checkChart(
      new Map([
        ['head', [cell('S', 1, 21, 21.5), cell('M', 2, 21.6, 22.5)]],
        ['single', [cell('S', 1, 30, 31)]],
      ]),
    );
    expect(check.measurements[0]?.gaps[0]?.widthInches).toBe(0.1);
    expect(check.warningCount).toBe(1);
  });
});
