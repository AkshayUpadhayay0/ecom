import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';

export type TokenAudience = 'customer' | 'admin';

/** Customer and admin tokens differ in BOTH signing secret and audience. */
export const TOKEN_AUDIENCES: Readonly<Record<TokenAudience, string>> = {
  customer: 'urban-ibile:customer',
  admin: 'urban-ibile:admin',
};
const ALGORITHM = 'HS256';
const MS_PER_SECOND = 1000;

export interface AccessTokenClaims {
  subjectId: string;
  /** Session family id; stable across refresh rotations. */
  sessionId: string;
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AccessTokens {
  sign(claims: AccessTokenClaims): Promise<SignedAccessToken>;
  /** Throws AppError TOKEN_EXPIRED / UNAUTHENTICATED (401). */
  verify(token: string): Promise<AccessTokenClaims>;
}

export interface AccessTokenConfig {
  audience: TokenAudience;
  secret: string;
  issuer: string;
  ttlSeconds: number;
}

function unauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
}

export function createAccessTokens(config: AccessTokenConfig): AccessTokens {
  const key = new TextEncoder().encode(config.secret);
  const audience = TOKEN_AUDIENCES[config.audience];

  return {
    async sign({ subjectId, sessionId }) {
      const issuedAt = Math.floor(Date.now() / MS_PER_SECOND);
      const expiresAtSeconds = issuedAt + config.ttlSeconds;
      const token = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(subjectId)
        .setAudience(audience)
        .setIssuer(config.issuer)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAtSeconds)
        .sign(key);
      return { token, expiresAt: new Date(expiresAtSeconds * MS_PER_SECOND) };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          audience,
          issuer: config.issuer,
          requiredClaims: ['sub', 'sid', 'exp'],
        });
        if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
          throw unauthenticated();
        }
        return { subjectId: payload.sub, sessionId: payload.sid };
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) {
          throw new AppError('TOKEN_EXPIRED', HTTP_STATUS.UNAUTHORIZED, 'Access token expired.');
        }
        throw unauthenticated();
      }
    },
  };
}

/** Extracts the token from `Authorization: Bearer <token>`. */
export function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
