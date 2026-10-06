import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { apiRateLimit } from './rate-limit.js';

/**
 * Stricter per-IP limit for credential and token endpoints (login, register, verification,
 * password reset). Each call returns a limiter with its own counter, so one route's traffic
 * does not consume another's budget.
 */
export function authRateLimit(
  env: Pick<Env, 'AUTH_RATE_LIMIT_WINDOW_MS' | 'AUTH_RATE_LIMIT_MAX'>,
): RequestHandler {
  return apiRateLimit({ windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS, max: env.AUTH_RATE_LIMIT_MAX });
}
