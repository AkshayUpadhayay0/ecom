// @vitest-environment node
import { NextRequest } from 'next/server';
import type * as Upstream from './upstream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callApi = vi.fn();
vi.mock('./upstream', async (importOriginal) => ({
  ...(await importOriginal<typeof Upstream>()),
  callApi: (...args: unknown[]) => callApi(...args) as unknown,
}));

const { forward, refreshTokens } = await import('./session');

function refreshOk(suffix: string) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        tokens: {
          accessToken: `access-${suffix}`,
          accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    }),
    setCookies: [`ui_rt=refresh-${suffix}; Path=/api/v1/auth; HttpOnly`],
  };
}

function requestWith(cookie: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/bff/cart', { headers: { cookie } });
}

describe('refreshTokens', () => {
  beforeEach(() => {
    callApi.mockReset();
  });

  it('refreshes once for parallel callers (the API revokes sessions on token reuse)', async () => {
    callApi.mockResolvedValue(refreshOk('1'));
    const [a, b, c] = await Promise.all([
      refreshTokens('old-token-single'),
      refreshTokens('old-token-single'),
      refreshTokens('old-token-single'),
    ]);
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.ok && a.tokens.refreshToken).toBe('refresh-1');
  });

  it('reports a rejected refresh token', async () => {
    callApi.mockResolvedValue({ status: 401, contentType: null, body: '{}', setCookies: [] });
    expect(await refreshTokens('old-token-rejected')).toEqual({ ok: false, status: 401 });
  });
});

describe('forward', () => {
  beforeEach(() => {
    callApi.mockReset();
  });

  it('answers 401 and clears the cookies when there is no session at all', async () => {
    const response = await forward(requestWith(''), {
      apiPath: 'cart',
      search: '',
      json: undefined,
      authenticated: true,
    });
    expect(response.status).toBe(401);
    expect(callApi).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie().join(';')).toContain('ui_at=;');
  });

  it('renews an expired access token from the refresh cookie and retries once', async () => {
    callApi.mockResolvedValueOnce(refreshOk('2')).mockResolvedValueOnce({
      status: 200,
      contentType: 'application/json',
      body: '{"data":{"lines":[]}}',
      setCookies: [],
    });
    const response = await forward(requestWith('ui_rt=old-token-renew'), {
      apiPath: 'cart',
      search: '',
      json: undefined,
      authenticated: true,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('lines');
    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).toContain('ui_at=access-2');
    expect(cookies).toContain('ui_rt=refresh-2');
    expect(cookies).toMatch(/ui_at=.*HttpOnly/i);
    expect((callApi.mock.calls[1]?.[0] as { accessToken: string }).accessToken).toBe('access-2');
  });

  it('refreshes after a 401 from the API and signs the shopper out when that fails too', async () => {
    callApi
      .mockResolvedValueOnce({
        status: 401,
        contentType: 'application/json',
        body: '{}',
        setCookies: [],
      })
      .mockResolvedValueOnce({ status: 401, contentType: null, body: '{}', setCookies: [] });
    const response = await forward(requestWith('ui_at=stale; ui_rt=old-token-dead'), {
      apiPath: 'cart',
      search: '',
      json: undefined,
      authenticated: true,
    });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(';')).toContain('ui_rt=;');
  });

  it('never forwards the browser cookies to the API', async () => {
    callApi.mockResolvedValue({
      status: 200,
      contentType: 'application/json',
      body: '{"data":[]}',
      setCookies: [],
    });
    await forward(requestWith('ui_at=token; ui_rt=r'), {
      apiPath: 'cart',
      search: '',
      json: undefined,
      authenticated: true,
    });
    const sent = callApi.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(sent)).not.toContain('cookie');
    expect(sent.accessToken).toBe('token');
  });
});
