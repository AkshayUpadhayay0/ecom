import type { Request, Response } from 'express';
import type { AuthTokensDto } from '@urban-ibile/shared';
import type { SignedAccessToken } from './access-tokens.js';
import type { SessionClient } from './sessions.repository.js';

/**
 * Browsers (web, admin panel) get the refresh token as an httpOnly SameSite=Strict cookie
 * scoped to the auth path, so page scripts can never read it. Mobile apps receive it in the
 * JSON body and keep it in the OS keychain/keystore.
 */
export interface RefreshCookieConfig {
  name: string;
  path: string;
  secure: boolean;
}

export function setRefreshCookie(
  res: Response,
  config: RefreshCookieConfig,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(config.name, token, {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
    path: config.path,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response, config: RefreshCookieConfig): void {
  res.clearCookie(config.name, {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict',
    path: config.path,
  });
}

/** Body token (mobile) wins; otherwise the cookie (browsers). */
export function readRefreshToken(
  req: Request,
  config: RefreshCookieConfig,
  bodyToken: string | undefined,
): string | undefined {
  if (bodyToken !== undefined) return bodyToken;
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[config.name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the token DTO and, for browser clients, moves the refresh token into the cookie.
 */
export function deliverTokens(
  res: Response,
  config: RefreshCookieConfig,
  client: SessionClient,
  access: SignedAccessToken,
  refresh: { refreshToken: string; expiresAt: Date },
): AuthTokensDto {
  const tokens: AuthTokensDto = {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
  if (client === 'web') {
    setRefreshCookie(res, config, refresh.refreshToken, refresh.expiresAt);
    return tokens;
  }
  return { ...tokens, refreshToken: refresh.refreshToken };
}

export function clientContextOf(req: Request): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  return { userAgent: req.get('user-agent') ?? null, ipAddress: req.ip ?? null };
}
