import type { Request, RequestHandler, Response } from 'express';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateMeRequestSchema,
  verifyEmailRequestSchema,
  type ApiData,
  type CustomerAuthDto,
  type CustomerDto,
} from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toCustomerDto } from './auth.dto.js';
import type { CustomerAuthService, CustomerSession } from './auth.service.js';
import { getCustomer } from './core/principals.js';
import {
  clearRefreshCookie,
  clientContextOf,
  deliverTokens,
  readRefreshToken,
  type RefreshCookieConfig,
} from './core/refresh-cookie.js';

export interface CustomerAuthController {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  getMe: RequestHandler;
  updateMe: RequestHandler;
  verifyEmail: RequestHandler;
  resendVerification: RequestHandler;
  forgotPassword: RequestHandler;
  resetPassword: RequestHandler;
}

/** Express 5 leaves req.body undefined when there is no body. */
function bodyOf(req: Request): unknown {
  return req.body ?? {};
}

export function createCustomerAuthController(
  service: CustomerAuthService,
  cookie: RefreshCookieConfig,
): CustomerAuthController {
  function sendSession(res: Response, status: number, session: CustomerSession): void {
    const body: ApiData<CustomerAuthDto> = {
      data: {
        customer: toCustomerDto(session.customer),
        tokens: deliverTokens(res, cookie, session.client, session.access, session.refresh),
      },
    };
    res.status(status).json(body);
  }

  function sendCustomer(res: Response, dto: CustomerDto): void {
    const body: ApiData<CustomerDto> = { data: dto };
    res.status(HTTP_STATUS.OK).json(body);
  }

  return {
    register: async (req, res) => {
      const input = registerRequestSchema.parse(bodyOf(req));
      const session = await service.register(input, {
        client: input.client,
        ...clientContextOf(req),
      });
      sendSession(res, HTTP_STATUS.CREATED, session);
    },

    login: async (req, res) => {
      const input = loginRequestSchema.parse(bodyOf(req));
      const session = await service.login(input.email, input.password, {
        client: input.client,
        ...clientContextOf(req),
      });
      sendSession(res, HTTP_STATUS.OK, session);
    },

    refresh: async (req, res) => {
      const input = refreshRequestSchema.parse(bodyOf(req));
      const token = readRefreshToken(req, cookie, input.refreshToken);
      if (token === undefined) {
        throw new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in again.');
      }
      try {
        const session = await service.refresh(token, clientContextOf(req));
        const body: ApiData<{ tokens: CustomerAuthDto['tokens'] }> = {
          data: {
            tokens: deliverTokens(res, cookie, session.client, session.access, session.refresh),
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
      sendCustomer(res, toCustomerDto(await service.getMe(getCustomer(req).id)));
    },

    updateMe: async (req, res) => {
      const patch = updateMeRequestSchema.parse(bodyOf(req));
      sendCustomer(res, toCustomerDto(await service.updateMe(getCustomer(req).id, patch)));
    },

    verifyEmail: async (req, res) => {
      const { token } = verifyEmailRequestSchema.parse(bodyOf(req));
      await service.verifyEmail(token);
      const body: ApiData<{ emailVerified: true }> = { data: { emailVerified: true } };
      res.status(HTTP_STATUS.OK).json(body);
    },

    resendVerification: async (req, res) => {
      await service.resendVerification(getCustomer(req).id);
      res.status(HTTP_STATUS.ACCEPTED).end();
    },

    forgotPassword: async (req, res) => {
      const { email } = forgotPasswordRequestSchema.parse(bodyOf(req));
      await service.forgotPassword(email);
      res.status(HTTP_STATUS.ACCEPTED).end();
    },

    resetPassword: async (req, res) => {
      const { token, newPassword } = resetPasswordRequestSchema.parse(bodyOf(req));
      await service.resetPassword(token, newPassword);
      res.status(HTTP_STATUS.NO_CONTENT).end();
    },
  };
}
