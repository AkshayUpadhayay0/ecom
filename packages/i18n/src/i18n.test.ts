import { describe, expect, it } from 'vitest';
import { createTranslator, interpolate, missingKeys, en } from './index';

describe('i18n', () => {
  it('answers English for en', () => {
    expect(createTranslator('en')('search.no_results')).toBe('No outfits found. Try another word.');
  });

  it('falls back to English per key when pcm is empty', () => {
    expect(createTranslator('pcm')('search.no_results')).toBe(en['search.no_results']);
    expect(missingKeys('pcm').length).toBe(Object.keys(en).length);
    expect(missingKeys('en')).toEqual([]);
  });

  it('interpolates {params} and leaves unknown ones visible', () => {
    expect(interpolate('Page {page} of {total}', { page: 2, total: 5 })).toBe('Page 2 of 5');
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
  });
});
