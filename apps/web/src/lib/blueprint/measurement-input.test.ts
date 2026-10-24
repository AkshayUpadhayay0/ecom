import { describe, expect, it } from 'vitest';
import { parseAllMeasurements, parseMeasurement } from './measurement-input';

const limits = { min: 5, max: 90 };

describe('parseMeasurement', () => {
  it.each([
    ['42', 42],
    ['42.5', 42.5],
    ['42,5', 42.5],
    [' 17.0 ', 17],
    ['7.', 7],
  ])('reads %j', (text, expected) => {
    expect(parseMeasurement(text, limits)).toEqual({ ok: true, value: expected });
  });

  it('reads a leading decimal mark (and then applies the minimum)', () => {
    expect(parseMeasurement('.5', { min: 0.1, max: 90 })).toEqual({ ok: true, value: 0.5 });
    expect(parseMeasurement('.5', limits).ok).toBe(false);
  });

  it('asks for a value when empty', () => {
    expect(parseMeasurement('  ', limits)).toEqual({
      ok: false,
      error: 'fms.measure.error.required',
    });
  });

  it.each(['abc', '4 2', '42..5', '-3', '1e2', '4.2.1', ',', '.', '+5'])(
    'rejects the shape %j',
    (text) => {
      expect(parseMeasurement(text, limits)).toEqual({
        ok: false,
        error: 'fms.measure.error.format',
      });
    },
  );

  it('allows one decimal at most', () => {
    expect(parseMeasurement('42.55', limits)).toEqual({
      ok: false,
      error: 'fms.measure.error.decimals',
    });
    expect(parseMeasurement('42,25', limits)).toEqual({
      ok: false,
      error: 'fms.measure.error.decimals',
    });
  });

  it('rejects zero and values outside the API limits', () => {
    expect(parseMeasurement('0', limits).ok).toBe(false);
    expect(parseMeasurement('4.9', limits)).toEqual({
      ok: false,
      error: 'fms.measure.error.min',
      params: { min: 5 },
    });
    expect(parseMeasurement('90.1', limits)).toEqual({
      ok: false,
      error: 'fms.measure.error.max',
      params: { max: 90 },
    });
    expect(parseMeasurement('90', limits)).toEqual({ ok: true, value: 90 });
    expect(parseMeasurement('5', limits)).toEqual({ ok: true, value: 5 });
  });

  it('does not accept a huge number of digits as a decimal trick', () => {
    expect(parseMeasurement('1'.repeat(400), limits).ok).toBe(false);
  });
});

describe('parseAllMeasurements', () => {
  const requirements = [
    { code: 'chest', minInches: 5, maxInches: 90 },
    { code: 'shoulder', minInches: 5, maxInches: 90 },
  ];
  it('returns inches by code when everything is valid', () => {
    expect(parseAllMeasurements(requirements, { chest: '42', shoulder: '17,5' })).toEqual({
      ok: true,
      values: { chest: 42, shoulder: 17.5 },
    });
  });
  it('reports each broken field', () => {
    const result = parseAllMeasurements(requirements, { chest: '', shoulder: '17.55' });
    expect(result).toEqual({
      ok: false,
      errors: {
        chest: { error: 'fms.measure.error.required' },
        shoulder: { error: 'fms.measure.error.decimals' },
      },
    });
  });
});
