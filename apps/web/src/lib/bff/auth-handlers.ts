import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, applySession, clearSession } from '@/lib/auth/cookies';
import { csrfGuard, readJson } from './guard';
import { errorResponse } from './session';
import { callApi, clientIpOf, readSetCookie } from './upstream';

const API_REFRESH_COOKIE = 'ui_rt';
/** The web client always identifies as "web": the API then puts the refresh token in a cookie. */
const WEB_CLIENT = 'web';

interface AuthBody {
  data?: {
    customer?: unknown;
    tokens?: {
      accessToken?: string;
      accessTokenExpiresAt?: string;
      refreshTokenExpiresAt?: string;
    };
  };
}

/**
 * Login and register. The API's answer carries the access token in the body and the refresh token
 * in Set-Cookie; both move into HttpOnly cookies of this site and the browser only gets the
 * customer profile back. Failures (bad password, lockout, rate limit...) pass through unchanged.
 */
export async function startSession(
  request: NextRequest,
  apiPath: 'auth/login' | 'auth/register',
): Promise<NextResponse> {
  const blocked = csrfGuard(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.json !== 'object' || body.json === null || Array.isArray(body.json)) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request.');
  }

  const result = await callApi({
    method: 'POST',
    path: apiPath,
    json: { ...(body.json as Record<string, unknown>), client: WEB_CLIENT },
    clientIp: clientIpOf(request.headers),
  });

  if (result.status !== 200 && result.status !== 201) {
    return new NextResponse(result.body, {
      status: result.status,
      headers: {
        'Content-Type': result.contentType ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const parsed = JSON.parse(result.body) as AuthBody;
  const tokens = parsed.data?.tokens;
  const refreshToken = readSetCookie(result.setCookies, API_REFRESH_COOKIE);
  if (
    !tokens?.accessToken ||
    !tokens.accessTokenExpiresAt ||
    !tokens.refreshTokenExpiresAt ||
    !refreshToken
  ) {
    return errorResponse(502, 'INTERNAL_ERROR', 'Try again.');
  }
  const response = NextResponse.json(
    { data: { customer: parsed.data?.customer } },
    { status: result.status, headers: { 'Cache-Control': 'no-store' } },
  );
  applySession(response, {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  });
  return response;
}

/** Logout: revoke the session at the API (best effort), then always clear the cookies. */
export async function endSession(request: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(request);
  if (blocked) return blocked;
  const refreshToken = request.cookies.get(COOKIE_NAMES.refresh)?.value;
  if (refreshToken) {
    try {
      await callApi({
        method: 'POST',
        path: 'auth/logout',
        json: { refreshToken },
        clientIp: clientIpOf(request.headers),
      });
    } catch {
      // The cookies are cleared either way; the refresh token also expires on its own.
    }
  }
  const response = new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
  clearSession(response);
  return response;
}
