import { ERROR_CODES } from '@urban-ibile/shared';
import { createTranslator, en } from '@urban-ibile/i18n';
import { describe, expect, it } from 'vitest';
import { BffError } from './bff';
import { describeError, flaggedFields } from './error-messages';

const t = createTranslator('en');

describe('describeError', () => {
  it('maps API codes to dictionary keys that exist', () => {
    const checked = [
      'INVALID_CREDENTIALS',
      'ACCOUNT_LOCKED',
      'RATE_LIMITED',
      'INSUFFICIENT_STOCK',
      'SIZE_NOT_OFFERED',
      'BLUEPRINT_OUT_OF_RANGE',
      'WEAK_PASSWORD',
    ];
    for (const code of checked) {
      const { key } = describeError(new BffError(400, code, 'English from the API'));
      expect(key in en, `${code} -> ${key}`).toBe(true);
      expect(key).not.toBe('err.generic');
    }
  });

  it('uses the neutral out-of-range wording', () => {
    const { key, params } = describeError(new BffError(422, 'BLUEPRINT_OUT_OF_RANGE', 'x'));
    expect(t(key, params)).toBe('We could not match this measurement to our size chart.');
  });

  it('puts the per-line limit into the message', () => {
    const { key, params } = describeError(
      new BffError(409, 'QUANTITY_LIMIT_EXCEEDED', 'x', { maxQuantity: 10 }),
    );
    expect(t(key, params)).toBe('You can add at most 10 of one item.');
  });

  it('never shows API text: unknown codes get the generic message, 429 the rate-limit one', () => {
    expect(describeError(new BffError(500, 'SOMETHING_NEW', 'leaky stack')).key).toBe(
      'err.generic',
    );
    expect(describeError(new BffError(429, 'WHATEVER', 'x')).key).toBe('err.RATE_LIMITED');
    expect(describeError(new Error('boom')).key).toBe('err.generic');
  });

  it('maps network failures', () => {
    expect(describeError(new BffError(0, 'NETWORK_ERROR', 'x')).key).toBe('err.NETWORK_ERROR');
  });

  it('has a dictionary entry for every code the website can meet', () => {
    const meet = ERROR_CODES.filter((code) => `err.${code}` in en);
    expect(meet.length).toBeGreaterThan(20);
  });
});

describe('flaggedFields', () => {
  it('collects field names from details.issues', () => {
    const error = new BffError(400, 'BLUEPRINT_MEASUREMENTS_INVALID', 'x', {
      issues: [
        { code: 'chest', message: 'a' },
        { field: 'waist', message: 'b' },
        { path: ['x', 'y'] },
      ],
    });
    expect([...flaggedFields(error)].sort()).toEqual(['chest', 'waist', 'x.y']);
  });
  it('is empty without details', () => {
    expect(flaggedFields(new BffError(400, 'X', 'x')).size).toBe(0);
  });
});
