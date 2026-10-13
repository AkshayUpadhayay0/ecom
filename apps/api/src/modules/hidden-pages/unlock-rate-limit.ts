import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';

export interface UnlockRateLimitOptions {
  windowMs: number;
  max: number;
  /** Counter key: the client IP (default) or the page's route token. */
  keyBy: 'ip' | 'page';
  /** Records the blocked attempt (qr_access_events); errors are swallowed. */
  onLimited: (req: Request) => Promise<void>;
}

/**
 * Brute-force guard for serial guessing. Only FAILED attempts count (a customer unlocking several
 * pages with valid serials is never blocked). In-memory store.
 * TEMP: switch to a shared store once the API runs on more than one instance.
 */
export function unlockRateLimit(options: UnlockRateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    ...(options.keyBy === 'page' && {
      keyGenerator: (req: Request) => `page:${String(req.params.routeToken)}`,
    }),
    handler: (req, _res, next) => {
      options
        .onLimited(req)
        .catch((err: unknown) => {
          req.log.error({ err }, 'hidden page: could not record rate-limited attempt');
        })
        .finally(() => {
          next(
            new AppError(
              'RATE_LIMITED',
              HTTP_STATUS.TOO_MANY_REQUESTS,
              'Too many attempts. Try again later.',
            ),
          );
        });
    },
  });
}
