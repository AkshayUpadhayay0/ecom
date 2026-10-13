import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { createSerialHasher } from '../serial-access/serial-hash.js';
import { createSerialsRepository } from '../serial-access/serials.repository.js';
import { createHiddenPagesController, routeTokenOf, visitorOf } from './hidden-pages.controller.js';
import { createHiddenPagesRepository } from './hidden-pages.repository.js';
import { HIDDEN_PAGES_PATH, createHiddenPagesRouter } from './hidden-pages.routes.js';
import { createHiddenPagesService } from './hidden-pages.service.js';
import { createPageAccessRepository } from './page-access.repository.js';
import { unlockRateLimit } from './unlock-rate-limit.js';

/** HttpOnly cookie holding the visitor's random browser token (only its hash is stored). */
export const HIDDEN_PAGE_COOKIE = 'ui_hp';

export interface HiddenPagesModuleDeps {
  env: Pick<
    Env,
    | 'SERIAL_HMAC_SECRET'
    | 'COOKIE_SECURE'
    | 'HIDDEN_UNLOCK_WINDOW_MS'
    | 'HIDDEN_UNLOCK_MAX_PER_IP'
    | 'HIDDEN_UNLOCK_MAX_PER_PAGE'
  >;
  db: Database;
  logger: Logger;
  basePath: string;
  optionalCustomer: RequestHandler;
}

/** Public hidden-page routes (mount at HIDDEN_PAGES_PATH). */
export function createHiddenPagesPublicRouter(deps: HiddenPagesModuleDeps): Router {
  const { env } = deps;
  const service = createHiddenPagesService({
    db: deps.db,
    pages: createHiddenPagesRepository(),
    access: createPageAccessRepository(),
    serials: createSerialsRepository(),
    hasher: createSerialHasher(env.SERIAL_HMAC_SECRET),
    logger: deps.logger,
  });
  const cookie = {
    name: HIDDEN_PAGE_COOKIE,
    path: `${deps.basePath}${HIDDEN_PAGES_PATH}`,
    secure: env.COOKIE_SECURE,
  };
  const onLimited = (req: Parameters<RequestHandler>[0]) =>
    service.logRateLimited(routeTokenOf(req), visitorOf(req, cookie));

  return createHiddenPagesRouter({
    controller: createHiddenPagesController(service, cookie),
    optionalCustomer: deps.optionalCustomer,
    unlockLimits: [
      unlockRateLimit({
        windowMs: env.HIDDEN_UNLOCK_WINDOW_MS,
        max: env.HIDDEN_UNLOCK_MAX_PER_IP,
        keyBy: 'ip',
        onLimited,
      }),
      unlockRateLimit({
        windowMs: env.HIDDEN_UNLOCK_WINDOW_MS,
        max: env.HIDDEN_UNLOCK_MAX_PER_PAGE,
        keyBy: 'page',
        onLimited,
      }),
    ],
  });
}
