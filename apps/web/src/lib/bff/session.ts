import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, applySession, clearSession, type SessionTokens } from '@/lib/auth/cookies';
import { callApi, clientIpOf, readSetCookie, type UpstreamResult } from './upstream';

/** Name of the refresh cookie the API sets (read from its Set-Cookie, re-issued as ui_rt). */
const API_REFRESH_COOKIE = 'ui_rt';
/** A finished refresh is remembered this long so parallel requests with the old cookie reuse it. */
const SUCCESS_MEMO_MS = 30_000;
const FAILURE_MEMO_MS = 1_000;

export type RefreshOutcome = { ok: true; tokens: SessionTokens } | { ok: false; status: number };

const inflight = new Map<string, Promise<RefreshOutcome>>();

interface RefreshBody {
  data?: {
    tokens?: {
      accessToken?: string;
      accessTokenExpiresAt?: string;
      refreshTokenExpiresAt?: string;
    };
  };
}

async function runRefresh(
  refreshToken: string,
  clientIp: string | undefined,
): Promise<RefreshOutcome> {
  let result: UpstreamResult;
  try {
    result = await callApi({
      method: 'POST',
      path: 'auth/refresh',
      json: { refreshToken },
      clientIp,
    });
  } catch {
    return { ok: false, status: 503 };
  }
  if (result.status !== 200) return { ok: false, status: result.status };
  const body = JSON.parse(result.body) as RefreshBody;
  const tokens = body.data?.tokens;
  const nextRefresh = readSetCookie(result.setCookies, API_REFRESH_COOKIE);
  if (
    !tokens?.accessToken ||
    !tokens.accessTokenExpiresAt ||
    !tokens.refreshTokenExpiresAt ||
    !nextRefresh
  ) {
    return { ok: false, status: 502 };
  }
  return {
    ok: true,
    tokens: {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: nextRefresh,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    },
  };
}

/**
 * Refreshes the session, once per refresh token. The API rotates refresh tokens and revokes the
 * whole session when an old one is presented again, so two parallel requests must never both
 * refresh: the second one gets the first one's result. (In-process only: with several web
 * instances the API needs a short rotation grace window, see the W2 notes.)
 */
export function refreshTokens(refreshToken: string, clientIp?: string): Promise<RefreshOutcome> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const promise = runRefresh(refreshToken, clientIp);
  inflight.set(refreshToken, promise);
  void promise.then((outcome) => {
    setTimeout(
      () => inflight.delete(refreshToken),
      outcome.ok ? SUCCESS_MEMO_MS : FAILURE_MEMO_MS,
    ).unref();
  });
  return promise;
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId: 'web-bff' } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function passThrough(result: UpstreamResult): NextResponse {
  const response = new NextResponse(result.body === '' ? null : result.body, {
    status: result.status,
    headers: result.contentType ? { 'Content-Type': result.contentType } : {},
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export interface ForwardOptions {
  apiPath: string;
  search: string;
  json: unknown;
  authenticated: boolean;
}

/**
 * Forwards one browser request to the API. Authenticated calls use the access cookie, refresh it
 * when it is missing or rejected (once), and always answer with Cache-Control: no-store.
 */
export async function forward(
  request: NextRequest,
  options: ForwardOptions,
): Promise<NextResponse> {
  const clientIp = clientIpOf(request.headers);
  const base = {
    method: request.method,
    path: options.apiPath,
    search: options.search,
    json: options.json,
    clientIp,
  };

  if (!options.authenticated) return passThrough(await callApi(base));

  let accessToken = request.cookies.get(COOKIE_NAMES.access)?.value;
  const refreshToken = request.cookies.get(COOKIE_NAMES.refresh)?.value;
  let renewed: SessionTokens | null = null;

  const signedOut = (): NextResponse => {
    const response = errorResponse(401, 'UNAUTHENTICATED', 'Sign in again.');
    clearSession(response);
    return response;
  };

  if (!accessToken) {
    if (!refreshToken) return signedOut();
    const outcome = await refreshTokens(refreshToken, clientIp);
    if (!outcome.ok)
      return outcome.status === 401
        ? signedOut()
        : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Try again.');
    renewed = outcome.tokens;
    accessToken = outcome.tokens.accessToken;
  }

  let result = await callApi({ ...base, accessToken });
  if (result.status === 401 && refreshToken && renewed === null) {
    const outcome = await refreshTokens(refreshToken, clientIp);
    if (!outcome.ok)
      return outcome.status === 401
        ? signedOut()
        : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Try again.');
    renewed = outcome.tokens;
    result = await callApi({ ...base, accessToken: outcome.tokens.accessToken });
  }

  const response = passThrough(result);
  if (result.status === 401) clearSession(response);
  else if (renewed) applySession(response, renewed);
  return response;
}
