import type { NextResponse } from 'next/server';
import { cookieSecure } from '@/config/env';

/**
 * Session cookies of the website (all on the website's own origin; the browser never talks to
 * the API directly):
 *  - ui_at   access token (HttpOnly, short-lived)
 *  - ui_rt   refresh token (HttpOnly, only sent to /api/bff)
 *  - ui_auth non-secret "signed in" hint so pages know whether to show account links (JS-readable,
 *            never trusted: every real request is checked by the API)
 *  - ui_csrf double-submit CSRF value (JS-readable on purpose)
 */
export const COOKIE_NAMES = {
  access: 'ui_at',
  refresh: 'ui_rt',
  hint: 'ui_auth',
  csrf: 'ui_csrf',
} as const;

export const BFF_PATH = '/api/bff';

/** The access cookie expires a little before the token does, so a stale token is never sent. */
const ACCESS_EARLY_EXPIRY_MS = 30_000;

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export function applySession(response: NextResponse, tokens: SessionTokens): void {
  const secure = cookieSecure();
  const accessExpires = new Date(
    Math.max(
      Date.now() + 1000,
      new Date(tokens.accessTokenExpiresAt).getTime() - ACCESS_EARLY_EXPIRY_MS,
    ),
  );
  const refreshExpires = new Date(tokens.refreshTokenExpiresAt);
  response.cookies.set(COOKIE_NAMES.access, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: accessExpires,
  });
  response.cookies.set(COOKIE_NAMES.refresh, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: BFF_PATH,
    expires: refreshExpires,
  });
  response.cookies.set(COOKIE_NAMES.hint, '1', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: refreshExpires,
  });
}

export function clearSession(response: NextResponse): void {
  const secure = cookieSecure();
  response.cookies.set(COOKIE_NAMES.access, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(COOKIE_NAMES.refresh, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: BFF_PATH,
    maxAge: 0,
  });
  response.cookies.set(COOKIE_NAMES.hint, '', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function setCsrfCookie(response: NextResponse, value: string): void {
  response.cookies.set(COOKIE_NAMES.csrf, value, {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}
