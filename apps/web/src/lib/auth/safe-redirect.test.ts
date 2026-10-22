import { describe, expect, it } from 'vitest';
import { loginHref, safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
  it('keeps same-site relative paths with query and hash', () => {
    expect(safeRedirect('/products/indigo-kaftan?intent=fit')).toBe(
      '/products/indigo-kaftan?intent=fit',
    );
    expect(safeRedirect('/cart#top')).toBe('/cart#top');
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '///evil.test',
    '/\\evil.test',
    '\\\\evil.test',
    'javascript:alert(1)',
    '/%0d%0a',
    '/a\nb',
    '/\t/evil.test',
    'evil',
    '',
  ])('rejects %j', (value) => {
    expect(safeRedirect(value)).toBe('/');
  });
  it('rejects null and undefined', () => {
    expect(safeRedirect(null)).toBe('/');
    expect(safeRedirect(undefined, '/shop')).toBe('/shop');
  });
  it('never returns to the auth pages', () => {
    expect(safeRedirect('/login?next=/cart')).toBe('/');
    expect(safeRedirect('/reset-password?token=abc')).toBe('/');
  });
  it('rejects absurdly long targets', () => {
    expect(safeRedirect(`/${'a'.repeat(3000)}`)).toBe('/');
  });
});

describe('loginHref', () => {
  it('encodes the return path', () => {
    expect(loginHref('/products/x?intent=fit')).toBe('/login?next=%2Fproducts%2Fx%3Fintent%3Dfit');
  });
  it('drops unsafe paths', () => {
    expect(loginHref('//evil.test')).toBe('/login');
    expect(loginHref('/cart', 'register')).toBe('/register?next=%2Fcart');
  });
});
