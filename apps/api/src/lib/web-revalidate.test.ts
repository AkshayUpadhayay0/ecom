import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createWebRevalidator } from './web-revalidate.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const URL_ = 'http://web.test/api/revalidate';
const SECRET = 'a-shared-secret-of-sufficient-length-123';

function make(fetchImpl: typeof fetch, extra = {}) {
  return createWebRevalidator({
    url: URL_,
    secret: SECRET,
    logger,
    debounceMs: 5,
    retryDelaysMs: [1, 1],
    fetchImpl,
    ...extra,
  });
}

describe('createWebRevalidator', () => {
  it('is a no-op when not configured', async () => {
    const fetchImpl = vi.fn();
    const r = createWebRevalidator({ url: undefined, secret: undefined, logger, fetchImpl });
    r.revalidate('x');
    await r.flush();
    expect(r.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends ONE authenticated request for calls close together', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const r = make(fetchImpl as unknown as typeof fetch);
    r.revalidate('a');
    r.revalidate('b');
    r.revalidate('a');
    await r.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog', 'site'], reason: 'a; b' });
  });

  it('retries a failure and never throws', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const r = make(fetchImpl as unknown as typeof fetch);
    r.revalidate('a');
    await expect(r.flush()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last attempt without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const r = make(fetchImpl as unknown as typeof fetch);
    r.revalidate('a');
    await expect(r.flush()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
