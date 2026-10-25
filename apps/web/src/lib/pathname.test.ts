import { describe, expect, it } from 'vitest';
import { isHomePath, pathWithoutLocale } from './pathname';

describe('pathWithoutLocale', () => {
  it('drops a leading language segment and leaves other paths alone', () => {
    expect(pathWithoutLocale('/en')).toBe('/');
    expect(pathWithoutLocale('/pcm/shop')).toBe('/shop');
    expect(pathWithoutLocale('/shop')).toBe('/shop');
    expect(pathWithoutLocale('/')).toBe('/');
    expect(pathWithoutLocale('/english-shop')).toBe('/english-shop');
  });

  it('knows the home page in both forms', () => {
    expect(isHomePath('/')).toBe(true);
    expect(isHomePath('/en')).toBe(true);
    expect(isHomePath('/en/shop')).toBe(false);
    expect(isHomePath('/shop')).toBe(false);
  });
});
