import type { RequestHandler } from 'express';
import cors from 'cors';
import { REQUEST_ID_HEADER } from './request-logger.js';

const PREFLIGHT_CACHE_SECONDS = 600;

/**
 * CORS restricted to an explicit allow-list. Requests without an Origin header (mobile app,
 * server-to-server, curl) are allowed; browser origins not on the list get no CORS headers.
 */
export function corsAllowList(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => {
      callback(null, origin === undefined || allowed.has(origin));
    },
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: PREFLIGHT_CACHE_SECONDS,
  });
}
