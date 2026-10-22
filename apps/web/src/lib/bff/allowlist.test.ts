import { describe, expect, it } from 'vitest';
import { matchBffPath } from './allowlist';

const id = '6c0f1d6e-2f0c-4d8e-9a39-5a1f0f0b8c21';

describe('matchBffPath', () => {
  it('allows the customer endpoints the website uses', () => {
    expect(matchBffPath('GET', 'cart')).toEqual({ allowed: true, auth: true });
    expect(matchBffPath('PATCH', `cart/items/${id}`)).toEqual({ allowed: true, auth: true });
    expect(matchBffPath('PUT', `cart/items/${id}/decision`)).toEqual({ allowed: true, auth: true });
    expect(matchBffPath('POST', 'blueprint/decisions')).toEqual({ allowed: true, auth: true });
    expect(matchBffPath('GET', `blueprint/products/${id}/requirements`)).toEqual({
      allowed: true,
      auth: true,
    });
    expect(matchBffPath('GET', 'me/addresses')).toEqual({ allowed: true, auth: true });
  });
  it('marks token-based auth endpoints as public', () => {
    expect(matchBffPath('POST', 'auth/verify-email')).toEqual({ allowed: true, auth: false });
    expect(matchBffPath('POST', 'auth/forgot-password')).toEqual({ allowed: true, auth: false });
  });
  it('refuses wrong methods and unknown or dangerous paths', () => {
    expect(matchBffPath('DELETE', 'cart')).toEqual({ allowed: false, reason: 'method' });
    expect(matchBffPath('POST', `me/addresses/${id}`)).toEqual({
      allowed: false,
      reason: 'method',
    });
    for (const path of [
      'admin/orders',
      'checkout/orders',
      'me/orders',
      'cart/../admin/stats',
      'auth/login',
      'cart/items/not-a-uuid',
      'cart/',
    ]) {
      expect(matchBffPath('GET', path).allowed).toBe(false);
    }
  });
});
