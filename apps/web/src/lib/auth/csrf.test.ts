import { describe, expect, it } from 'vitest';
import { verifyCsrf, type CsrfInput } from './csrf';

const base: CsrfInput = {
  method: 'POST',
  headerToken: 'abc123',
  cookieToken: 'abc123',
  origin: 'https://shop.test',
  fetchSite: 'same-origin',
  siteOrigin: 'https://shop.test',
};

describe('verifyCsrf', () => {
  it('accepts a same-origin request with matching tokens', () => {
    expect(verifyCsrf(base)).toEqual({ ok: true });
  });
  it('does not check safe methods', () => {
    expect(
      verifyCsrf({ ...base, method: 'GET', headerToken: null, cookieToken: undefined }),
    ).toEqual({ ok: true });
  });
  it('rejects a foreign origin', () => {
    expect(verifyCsrf({ ...base, origin: 'https://evil.test' })).toEqual({
      ok: false,
      reason: 'origin',
    });
  });
  it('rejects cross-site fetches', () => {
    expect(verifyCsrf({ ...base, fetchSite: 'cross-site' })).toEqual({
      ok: false,
      reason: 'fetch-site',
    });
  });
  it('rejects a missing or mismatched token', () => {
    expect(verifyCsrf({ ...base, headerToken: null })).toEqual({ ok: false, reason: 'token' });
    expect(verifyCsrf({ ...base, cookieToken: undefined })).toEqual({ ok: false, reason: 'token' });
    expect(verifyCsrf({ ...base, headerToken: 'other1' })).toEqual({ ok: false, reason: 'token' });
  });
  it('accepts requests without Origin / Fetch-Metadata headers when the tokens match', () => {
    expect(verifyCsrf({ ...base, origin: null, fetchSite: null })).toEqual({ ok: true });
  });
});
