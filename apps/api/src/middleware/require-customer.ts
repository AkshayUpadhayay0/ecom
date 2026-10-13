import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';
import { readBearerToken, type AccessTokens } from '../modules/auth/core/access-tokens.js';

/**
 * Requires a valid CUSTOMER access token (`Authorization: Bearer ...`). Admin tokens fail
 * because they are signed with a different secret and audience.
 * Stateless by design (no DB hit): a revoked session stays usable until its access token
 * expires (ACCESS_TOKEN_TTL_SECONDS, default 15 minutes).
 */
export function requireCustomer(accessTokens: AccessTokens): RequestHandler {
  return async (req, _res, next) => {
    const token = readBearerToken(req.get('authorization'));
    if (token === undefined) {
      throw new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
    }
    const claims = await accessTokens.verify(token);
    req.customer = { id: claims.subjectId, sessionId: claims.sessionId };
    next();
  };
}

/**
 * Public routes that behave better for signed-in customers: sets req.customer when a valid
 * customer token is present, and otherwise continues anonymously (never rejects).
 */
export function optionalCustomer(accessTokens: AccessTokens): RequestHandler {
  return async (req, _res, next) => {
    const token = readBearerToken(req.get('authorization'));
    if (token !== undefined) {
      try {
        const claims = await accessTokens.verify(token);
        req.customer = { id: claims.subjectId, sessionId: claims.sessionId };
      } catch {
        // An expired or foreign token on a public route is treated as "not signed in".
      }
    }
    next();
  };
}
