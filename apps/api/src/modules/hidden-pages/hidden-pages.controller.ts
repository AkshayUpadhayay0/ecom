import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import {
  listHiddenPagesQuerySchema,
  routeTokenSchema,
  unlockHiddenPageSchema,
  updateHiddenPageContentSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { stringParam, uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { HiddenPagesAdminService } from './hidden-pages-admin.service.js';
import type { HiddenPagesService, VisitorContext } from './hidden-pages.service.js';

/** Browsers cap cookie lifetime at 400 days; grants themselves never expire. */
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export interface HiddenPageCookieConfig {
  name: string;
  /** Path the cookie is sent to (the public hidden-pages routes only). */
  path: string;
  secure: boolean;
}

export interface HiddenPagesController {
  getState: RequestHandler;
  unlock: RequestHandler;
}

export interface HiddenPagesAdminController {
  list: RequestHandler;
  get: RequestHandler;
  updateContent: RequestHandler;
}

/** Hidden pages must never be indexed or cached (answers depend on the visitor's cookie). */
function setPrivacyHeaders(res: Response): void {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
}

export function visitorOf(req: Request, cookie: HiddenPageCookieConfig): VisitorContext {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const raw = cookies?.[cookie.name];
  return {
    browserToken: typeof raw === 'string' && raw !== '' ? raw : undefined,
    customerId: req.customer?.id ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export function routeTokenOf(req: Request): string {
  return stringParam(req, 'routeToken', routeTokenSchema);
}

export function createHiddenPagesController(
  service: HiddenPagesService,
  cookie: HiddenPageCookieConfig,
): HiddenPagesController {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: 'lax',
    path: cookie.path,
    maxAge: COOKIE_MAX_AGE_MS,
  };

  return {
    getState: async (req, res) => {
      setPrivacyHeaders(res);
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.getState(routeTokenOf(req), visitorOf(req, cookie)),
      );
    },

    unlock: async (req, res) => {
      setPrivacyHeaders(res);
      const { serial } = unlockHiddenPageSchema.parse(bodyOf(req));
      const result = await service.unlock(routeTokenOf(req), serial, visitorOf(req, cookie));
      if (result.newBrowserToken !== undefined) {
        res.cookie(cookie.name, result.newBrowserToken, cookieOptions);
      }
      sendData(res, HTTP_STATUS.OK, result.state);
    },
  };
}

export function createHiddenPagesAdminController(
  service: HiddenPagesAdminService,
): HiddenPagesAdminController {
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listHiddenPagesQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req)));
    },
    updateContent: async (req, res) => {
      const id = uuidParam(req);
      const input = updateHiddenPageContentSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.updateContent(auditActorOf(req), id, input));
    },
  };
}
