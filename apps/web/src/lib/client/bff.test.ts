import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BffError, bff } from './bff';

type FetchCall = { url: string; cache: RequestCache | undefined };

function stubFetch(answers: (call: FetchCall, index: number) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    // The client only ever passes string URLs.
    const call = { url: input as string, cache: init?.cache };
    calls.push(call);
    return Promise.resolve(answers(call, calls.length - 1));
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bff client and "304 Not Modified"', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'cookie', { value: 'ui_csrf=token123', configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('private data is requested with no-store', async () => {
    const calls = stubFetch(() => json({ data: { lines: [] } }));
    await expect(bff('cart')).resolves.toEqual({ lines: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cache).toBe('no-store');
  });

  it('never shows a stray 304 as an error: asks again (bypassing caches) and returns the data', async () => {
    const calls = stubFetch((_call, index) =>
      index === 0 ? new Response(null, { status: 304 }) : json({ data: { ok: true } }),
    );
    await expect(bff('cart')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.cache)).toEqual(['no-store', 'reload']);
  });

  it('last resort: a throw-away query parameter', async () => {
    const calls = stubFetch((_call, index) =>
      index < 2 ? new Response(null, { status: 304 }) : json({ data: 1 }),
    );
    await expect(bff('me/addresses')).resolves.toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toMatch(/me\/addresses\?_nc=\d+/);
  });

  it('a 304 that never goes away is a typed error (never a JSON parse failure)', async () => {
    stubFetch(() => new Response(null, { status: 304 }));
    const error = await bff('cart').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BffError);
    expect((error as BffError).status).toBe(304);
    expect((error as BffError).code).toBe('UNEXPECTED_RESPONSE');
  });

  it('a network failure is a NETWORK_ERROR the UI maps to a friendly message', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const error = await bff('cart').catch((e: unknown) => e);
    expect((error as BffError).code).toBe('NETWORK_ERROR');
  });
});
