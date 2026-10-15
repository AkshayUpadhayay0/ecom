import { describe, expect, it } from 'vitest';
import {
  OUT_OF_RANGE_POLICY,
  recommendSize,
  type ChartRowInput,
  type EngineItem,
} from './blueprint-engine.js';

/** Rows copied from the seeded male_top chart (inches). */
const row = (
  code: string,
  sortOrder: number,
  minInches: number,
  maxInches: number,
): ChartRowInput => ({
  sizeId: `size-${code}`,
  sizeCode: code,
  sizeLabel: code,
  sortOrder,
  minInches,
  maxInches,
});
const CHEST: EngineItem = {
  measurementCode: 'chest',
  label: 'Chest',
  chartId: 'chart-top',
  chartGroup: 'male_top',
  chartVersion: 1,
  rows: [
    row('L', 3, 41, 43),
    row('M', 2, 38, 40),
    row('XL', 4, 44, 46),
    row('XXL', 5, 47, 49),
    row('3XL', 6, 50, 53),
  ],
};
const SLEEVE: EngineItem = {
  ...CHEST,
  measurementCode: 'sleeve',
  label: 'Sleeve',
  rows: [
    row('M', 2, 24, 25),
    row('L', 3, 25, 26),
    row('XL', 4, 25, 26),
    row('XXL', 5, 26, 27),
    row('3XL', 6, 26, 27),
  ],
};

const run = (values: Record<string, number>, items = [CHEST], rejectBelowChartMin = false) =>
  recommendSize({ items, values: new Map(Object.entries(values)), rejectBelowChartMin });

describe('recommendSize (SMALLEST_COVERING_SIZE, largest per outfit)', () => {
  it('maps a value to the smallest size whose max covers it (min is ignored)', () => {
    expect(run({ chest: 42 })).toMatchObject({ ok: true, recommended: { sizeCode: 'L' } });
    expect(run({ chest: 40.5 })).toMatchObject({ ok: true, recommended: { sizeCode: 'L' } }); // gap 40-41
    expect(run({ chest: 40 })).toMatchObject({ ok: true, recommended: { sizeCode: 'M' } }); // exact max
    expect(run({ chest: 30 })).toMatchObject({ ok: true, recommended: { sizeCode: 'M' } }); // below min
    // Overlap: sleeve 25 is in M and L; the smallest wins.
    expect(run({ sleeve: 25 }, [SLEEVE])).toMatchObject({
      ok: true,
      recommended: { sizeCode: 'M' },
    });
  });

  it('takes the largest size required by any measurement', () => {
    const result = run({ chest: 39, sleeve: 26.5 }, [CHEST, SLEEVE]);
    expect(
      result.ok && result.breakdown.map((b) => [b.measurementCode, b.required.sizeCode]),
    ).toEqual([
      ['chest', 'M'],
      ['sleeve', 'XXL'],
    ]);
    expect(result.ok && result.recommended.sizeCode).toBe('XXL');
  });

  it('refuses values above the chart (never auto-picks the largest size)', () => {
    expect(OUT_OF_RANGE_POLICY).toBe('REJECT');
    expect(run({ chest: 54 })).toEqual({
      ok: false,
      outOfRange: [
        {
          measurementCode: 'chest',
          label: 'Chest',
          valueInches: 54,
          chartMinInches: 38,
          chartMaxInches: 53,
          side: 'above',
        },
      ],
    });
    expect(run({ chest: 53 })).toMatchObject({ ok: true, recommended: { sizeCode: '3XL' } });
  });

  it('refuses values below the chart only when the pending setting says so', () => {
    expect(run({ chest: 30 }, [CHEST], true)).toMatchObject({
      ok: false,
      outOfRange: [{ side: 'below' }],
    });
    expect(run({ chest: 38 }, [CHEST], true)).toMatchObject({
      ok: true,
      recommended: { sizeCode: 'M' },
    });
  });
});
