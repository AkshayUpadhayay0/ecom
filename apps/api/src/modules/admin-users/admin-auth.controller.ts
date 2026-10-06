import type { Request, RequestHandler } from 'express';
import {
  adminChangePasswordRequestSchema,
  adminLoginRequestSchema,
  refreshRequestSchema,
  type AdminAuthDto,
  type AdminDto,
  type ApiData,
  type AuthTokensDto,
} from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { getAdmin } from '../auth/core/principals.js';
import {
  clearRefreshCookie,
  clientContextOf,
  deliverTokens,
  readRefreshToken,
  type RefreshCookieConfig,
} from '../auth/core/refresh-cookie.js';
import { toAdminDto } from './admin-auth.dto.js';
import type { AdminAuthService } from './admin-auth.service.js';

const ADMIN_CLIENT = 'web';

export interface AdminAuthController {
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  getMe: RequestHandler;
  changePassword: RequestHandler;
}

function bodyOf(req: Request): unknown {
  return req.body ?? {};
}

export function createAdminAuthController(
  service: AdminAuthService,
  cookie: RefreshCookieConfig,
): AdminAuthController {
  return {
    login: async (req, res) => {
      const { email, password } = adminLoginRequestSchema.parse(bodyOf(req));
      const session = await service.login(email, password, clientContextOf(req));
      const body: ApiData<AdminAuthDto> = {
        data: {
          admin: toAdminDto(session.admin),
          tokens: deliverTokens(res, cookie, ADMIN_CLIENT, session.access, session.refresh),
        },
      };
      res.status(HTTP_STATUS.OK).json(body);
    },

    refresh: async (req, res) => {
      const input = refreshRequestSchema.parse(bodyOf(req));
      const token = readRefreshToken(req, cookie, input.refreshToken);
      if (token === undefined) {
        throw new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in again.');
      }
      try {
        const session = await service.refresh(token, clientContextOf(req));
        const body: ApiData<{ tokens: AuthTokensDto }> = {
          data: {
            tokens: deliverTokens(res, cookie, ADMIN_CLIENT, session.access, session.refresh),
          },
        };
        res.status(HTTP_STATUS.OK).json(body);
      } catch (err) {
        clearRefreshCookie(res, cookie);
        throw err;
      }
    },

    logout: async (req, res) => {
      const input = refreshRequestSchema.parse(bodyOf(req));
      await service.logout(readRefreshToken(req, cookie, input.refreshToken));
      clearRefreshCookie(res, cookie);
      res.status(HTTP_STATUS.NO_CONTENT).end();
    },

    getMe: async (req, res) => {
      const body: ApiData<AdminDto> = {
        data: toAdminDto(await service.getMe(getAdmin(req).id)),
      };
      res.status(HTTP_STATUS.OK).json(body);
    },

    changePassword: async (req, res) => {
      const { currentPassword, newPassword } = adminChangePasswordRequestSchema.parse(bodyOf(req));
      await service.changePassword(getAdmin(req), currentPassword, newPassword, req.ip ?? null);
      res.status(HTTP_STATUS.NO_CONTENT).end();
    },
  };
}
