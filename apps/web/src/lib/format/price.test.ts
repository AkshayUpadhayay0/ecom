import { describe, expect, it } from 'vitest';
import { formatPrice, majorUnitsString } from './price';

describe('formatPrice', () => {
  it('formats NGN minor units with the Naira sign', () => {
    expect(formatPrice(3_500_000)).toBe('₦35,000');
    expect(formatPrice(3_500_000)).toContain('₦');
  });

  it('keeps kobo when the amount is not whole', () => {
    expect(formatPrice(1_250_050)).toBe('₦12,500.50');
  });

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('₦0');
  });
});

describe('majorUnitsString', () => {
  it('works from integers', () => {
    expect(majorUnitsString(3_500_000)).toBe('35000.00');
    expect(majorUnitsString(1_250_005)).toBe('12500.05');
  });
});
