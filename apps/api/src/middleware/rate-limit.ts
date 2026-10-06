import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Paths (relative to the mount point) that are never limited, e.g. `/health`. */
  skipPaths?: readonly string[];
}

/**
 * Per-IP rate limiter (in-memory store).
 * TEMP: switch to a shared Redis store once the API runs on more than one instance.
 */
export function apiRateLimit(options: RateLimitOptions): RequestHandler {
  const skipPaths = new Set(options.skipPaths ?? []);
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => skipPaths.has(req.path),
    handler: (_req, _res, next) => {
      next(
        new AppError(
          'RATE_LIMITED',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          'Too many requests. Try again later.',
        ),
      );
    },
  });
}
