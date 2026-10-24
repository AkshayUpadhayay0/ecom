import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, server } from '@/test/api-mock';
import { putToStorage } from './catalog';
import { ApiError, apiRequest, session } from './client';

const LIST = { data: [{ id: 'a' }], meta: { page: 1, pageSize: 24, total: 1, totalPages: 1 } };

describe('apiRequest and "304 Not Modified"', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never shows a stray 304 as an error: it asks again and returns the data', async () => {
    const seen: { cache: string; url: string }[] = [];
    server.use(
      http.get(`${API}/admin/media`, ({ request }) => {
        seen.push({ cache: request.cache, url: request.url });
        return seen.length === 1
          ? new HttpResponse(null, { status: 304 })
          : HttpResponse.json(LIST);
      }),
    );
    session.setAccessToken('t');
    await expect(apiRequest('/admin/media?page=1&pageSize=24')).resolves.toEqual(LIST);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.cache).toBe('no-store'); // private calls are never cached or revalidated
    expect(seen[1]?.cache).toBe('reload');
  });

  it('as a last resort bypasses every cache with a throw-away query parameter', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/admin/media`, ({ request }) => {
        urls.push(request.url);
        return urls.length < 3 ? new HttpResponse(null, { status: 304 }) : HttpResponse.json(LIST);
      }),
    );
    session.setAccessToken('t');
    await expect(apiRequest('/admin/media?page=1')).resolves.toEqual(LIST);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toMatch(/[?&]_nc=\d+/);
    expect(urls[0]).not.toContain('_nc=');
  });

  it('a 304 that never goes away is a clear error, not an empty page and not a JSON failure', async () => {
    server.use(http.get(`${API}/admin/media`, () => new HttpResponse(null, { status: 304 })));
    session.setAccessToken('t');
    const error = await apiRequest('/admin/media').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(304);
    expect((error as ApiError).message).toMatch(/not modified/i);
  });

  it('a normal 200 is untouched (one request)', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/admin/media`, () => {
        calls += 1;
        return HttpResponse.json(LIST);
      }),
    );
    session.setAccessToken('t');
    await apiRequest('/admin/media');
    expect(calls).toBe(1);
  });
});

describe('network failures say what is wrong', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the API address when it cannot be reached', async () => {
    server.use(http.get(`${API}/admin/media`, () => HttpResponse.error()));
    const error = (await apiRequest('/admin/media').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toContain('Cannot reach the server');
    expect(error.message).toContain('http://localhost:4000');
    expect(error.message).toContain('CORS_ORIGINS');
  });

  it('says so when the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    server.use(http.get(`${API}/admin/media`, () => HttpResponse.error()));
    const error = (await apiRequest('/admin/media').catch((e: unknown) => e)) as ApiError;
    expect(error.message).toMatch(/offline/i);
  });
});

describe('putToStorage explains why an upload failed', () => {
  const STORAGE = 'https://storage.example.test/object';
  const upload = {
    url: STORAGE,
    method: 'PUT' as const,
    headers: { 'Content-Type': 'image/jpeg' },
    expiresAt: '',
  };
  const file = new File(['x'], 'look.jpg', { type: 'image/jpeg' });

  async function failure(): Promise<ApiError> {
    return (await putToStorage(upload, file).then(
      () => undefined,
      (e: unknown) => e,
    )) as ApiError;
  }

  it.each([
    [403, /expired|refused/i],
    [413, /too large/i],
    [415, /did not accept this file/i],
    [404, /no longer valid/i],
    [503, /having trouble/i],
  ])('storage answers %i', async (status, message) => {
    server.use(http.put(STORAGE, () => new HttpResponse('<Error/>', { status })));
    const error = await failure();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('UPLOAD_FAILED');
    expect(error.status).toBe(status);
    expect(error.message).toMatch(message);
  });

  it("uses the API's own message from the local development storage (file too large, wrong type...)", async () => {
    server.use(
      http.put(STORAGE, () =>
        HttpResponse.json(
          {
            error: {
              code: 'UPLOAD_MISMATCH',
              message: 'The file is larger than the size you declared.',
            },
          },
          { status: 422 },
        ),
      ),
    );
    expect((await failure()).message).toBe('The file is larger than the size you declared.');
  });

  it('a blocked or dropped upload is described as such, not as "cannot reach the server"', async () => {
    server.use(http.put(STORAGE, () => HttpResponse.error()));
    const error = await failure();
    expect(error.code).toBe('UPLOAD_FAILED');
    expect(error.message).toMatch(/could not be sent to storage/i);
    expect(error.message).toMatch(/CORS/);
    expect(error.message).not.toMatch(/Cannot reach the server/);
  });
});
