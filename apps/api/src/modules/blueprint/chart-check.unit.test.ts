import { describe, expect, it } from 'vitest';
import { UPPER_LIMIT_TEXT, checkChart, checkColumn, type CheckSize } from './chart-check.js';

const SIZES: CheckSize[] = [
  { code: 'M', sortOrder: 2 },
  { code: 'S', sortOrder: 1 }, // out of order on purpose: sorting uses sort_order
  { code: 'L', sortOrder: 3 },
  { code: 'XL', sortOrder: 4 },
];

const column = (code: string, maxes: Record<string, number>) => ({
  code,
  label: code,
  maxBySize: new Map(Object.entries(maxes)),
});

describe('checkColumn (SMALLEST_COVERING_SIZE: only max values matter)', () => {
  it('reports nothing but the upper limit for strictly increasing maxes', () => {
    const items = checkColumn(SIZES, column('chest', { S: 36, M: 40, L: 43, XL: 46 }));
    expect(items.map((item) => item.code)).toEqual(['UPPER_LIMIT']);
    expect(items[0]).toMatchObject({
      severity: 'info',
      sizes: ['XL'],
      values: [{ size: 'XL', maxInches: 46 }],
    });
    expect(items[0]?.message).toContain(UPPER_LIMIT_TEXT);
  });

  it('flags a larger size whose max is below a smaller size (MAX_NOT_INCREASING)', () => {
    const items = checkColumn(SIZES, column('waist', { S: 30, M: 34, L: 33, XL: 38 }));
    const warning = items.find((item) => item.code === 'MAX_NOT_INCREASING');
    expect(warning).toMatchObject({
      severity: 'warning',
      sizes: ['M', 'L'],
      values: [
        { size: 'M', maxInches: 34 },
        { size: 'L', maxInches: 33 },
      ],
    });
    expect(items.find((item) => item.code === 'UPPER_LIMIT')?.values).toEqual([
      { size: 'XL', maxInches: 38 },
    ]);
  });

  it('groups consecutive equal maxes into one MAX_TIE notice', () => {
    const items = checkColumn(SIZES, column('length', { S: 62, M: 62, L: 62, XL: 64 }));
    expect(items.filter((item) => item.code === 'MAX_TIE')).toEqual([
      expect.objectContaining({
        severity: 'notice',
        sizes: ['S', 'M', 'L'],
        message: expect.stringContaining('only S can be recommended') as string,
      }),
    ]);
  });

  it('flags a missing cell (MISSING_CELL) and still checks the other sizes', () => {
    const items = checkColumn(SIZES, column('hip', { S: 36, M: 40, XL: 46 }));
    expect(items.map((item) => [item.code, item.sizes])).toEqual([
      ['MISSING_CELL', ['L']],
      ['UPPER_LIMIT', ['XL']],
    ]);
    expect(items[0]).toMatchObject({ severity: 'warning', values: [] });
  });

  it('ignores min values entirely: range gaps and overlaps are not findings', () => {
    // Female bust maxes 33, 36, 38, 42 (the old "gaps") increase, so nothing is reported.
    const sizes = ['XS', 'S', 'M', 'L'].map((code, index) => ({ code, sortOrder: index + 1 }));
    const items = checkColumn(sizes, column('bust', { XS: 33, S: 36, M: 38, L: 42 }));
    expect(items.map((item) => item.code)).toEqual(['UPPER_LIMIT']);
  });

  it('compares one-decimal values without float noise', () => {
    const items = checkColumn(SIZES, column('head', { S: 21.5, M: 21.5, L: 22.5, XL: 23.5 }));
    expect(items.find((item) => item.code === 'MAX_TIE')?.sizes).toEqual(['S', 'M']);
  });
});

describe('checkChart', () => {
  it('counts warnings and notices; info items are counted separately', () => {
    const check = checkChart(SIZES, [
      column('a', { S: 1, M: 2, L: 1.5, XL: 3 }), // 1 warning
      column('b', { S: 5, M: 5, L: 6, XL: 7 }), // 1 notice
    ]);
    expect(check).toMatchObject({ warningCount: 1, noticeCount: 1, infoCount: 2 });
  });
});
