import type { RegisterRequest, UpdateMeRequest } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import type { AuthRepository, CustomerRow } from './auth.repository.js';
import type { AccessTokens, SignedAccessToken } from './core/access-tokens.js';
import { invalidCredentials, verifyLoginWithLockout } from './core/lockout.js';
import { generateOpaqueToken, hashOpaqueToken } from './core/opaque-token.js';
import { assertPasswordAllowed, hashPassword } from './core/passwords.js';
import type { ClientContext, IssuedRefreshToken, SessionService } from './core/sessions.service.js';
import type { SessionClient } from './core/sessions.repository.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const ACTIVE_STATUS = 'active';

export interface CustomerSession {
  customer: CustomerRow;
  access: SignedAccessToken;
  refresh: IssuedRefreshToken;
  client: SessionClient;
}

export interface RefreshedSession {
  access: SignedAccessToken;
  refresh: IssuedRefreshToken;
  client: SessionClient;
}

export interface CustomerAuthService {
  register(input: RegisterRequest, ctx: ClientContext): Promise<CustomerSession>;
  login(email: string, password: string, ctx: ClientContext): Promise<CustomerSession>;
  refresh(refreshToken: string, ctx: Omit<ClientContext, 'client'>): Promise<RefreshedSession>;
  logout(refreshToken: string | undefined): Promise<void>;
  getMe(customerId: string): Promise<CustomerRow>;
  updateMe(customerId: string, patch: UpdateMeRequest): Promise<CustomerRow>;
  verifyEmail(token: string): Promise<void>;
  resendVerification(customerId: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
}

export type AuthSettings = Pick<
  Env,
  | 'PASSWORD_MIN_LENGTH'
  | 'AUTH_MAX_FAILED_LOGINS'
  | 'AUTH_LOCKOUT_MINUTES'
  | 'EMAIL_VERIFICATION_TTL_HOURS'
  | 'PASSWORD_RESET_TTL_MINUTES'
  | 'PUBLIC_WEB_URL'
  | 'TERMS_VERSION'
>;

export interface CustomerAuthServiceDeps {
  db: Database;
  repository: AuthRepository;
  outbox: EmailOutboxRepository;
  sessions: SessionService;
  accessTokens: AccessTokens;
  settings: AuthSettings;
  logger: Logger;
}

function invalidToken(): AppError {
  return new AppError(
    'INVALID_TOKEN',
    HTTP_STATUS.BAD_REQUEST,
    'This link is invalid or has expired.',
  );
}

function notFoundCustomer(): AppError {
  return new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
}

export function createCustomerAuthService(deps: CustomerAuthServiceDeps): CustomerAuthService {
  const { db, repository, outbox, sessions, accessTokens, settings } = deps;
  const lockoutPolicy = {
    maxFailedLogins: settings.AUTH_MAX_FAILED_LOGINS,
    lockoutMinutes: settings.AUTH_LOCKOUT_MINUTES,
  };

  /** [PENDING] website routes for these pages; agreed when the website is built. */
  function emailLink(path: string, token: string): string {
    const url = new URL(path, settings.PUBLIC_WEB_URL);
    url.searchParams.set('token', token);
    return url.toString();
  }

  async function queueVerificationEmail(executor: Database, customer: CustomerRow): Promise<void> {
    const token = generateOpaqueToken();
    await repository.replaceOneTimeToken(
      executor,
      'email_verification_tokens',
      customer.id,
      hashOpaqueToken(token),
      new Date(Date.now() + settings.EMAIL_VERIFICATION_TTL_HOURS * MS_PER_HOUR),
    );
    await outbox.enqueue(executor, {
      template: 'email_verification',
      recipient: customer.email,
      languageCode: customer.preferredLanguage,
      payload: { fullName: customer.fullName, link: emailLink('/verify-email', token) },
    });
  }

  async function loadActiveCustomer(customerId: string): Promise<CustomerRow> {
    const customer = await repository.findCustomerById(db, customerId);
    if (customer?.status !== ACTIVE_STATUS) throw notFoundCustomer();
    return customer;
  }

  async function issueSession(
    customer: CustomerRow,
    refresh: IssuedRefreshToken,
    client: SessionClient,
  ): Promise<CustomerSession> {
    const access = await accessTokens.sign({
      subjectId: customer.id,
      sessionId: refresh.familyId,
    });
    return { customer, access, refresh, client };
  }

  return {
    async register(input, ctx) {
      assertPasswordAllowed({
        password: input.password,
        email: input.email,
        minLength: settings.PASSWORD_MIN_LENGTH,
      });
      const passwordHash = await hashPassword(input.password);

      const { customer, refresh } = await db.transaction().execute(async (trx) => {
        const created = await repository.insertCustomer(trx, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone ?? null,
          termsVersion: settings.TERMS_VERSION,
        });
        if (!created) {
          throw new AppError(
            'EMAIL_ALREADY_REGISTERED',
            HTTP_STATUS.CONFLICT,
            'An account with this email already exists.',
          );
        }
        await queueVerificationEmail(trx, created);
        return { customer: created, refresh: await sessions.start(trx, created.id, ctx) };
      });

      return issueSession(customer, refresh, ctx.client);
    },

    async login(email, password, ctx) {
      const customer = await repository.findCustomerByEmail(db, email);
      await verifyLoginWithLockout(
        db,
        'customers',
        customer && {
          id: customer.id,
          passwordHash: customer.passwordHash,
          lockedUntil: customer.lockedUntil,
          isActive: customer.status === ACTIVE_STATUS,
        },
        password,
        lockoutPolicy,
      );
      if (!customer) throw invalidCredentials(); // unreachable: verifyLoginWithLockout threw
      const refresh = await sessions.start(db, customer.id, ctx);
      return issueSession(customer, refresh, ctx.client);
    },

    async refresh(refreshToken, ctx) {
      const rotated = await sessions.rotate(refreshToken, ctx);
      const access = await accessTokens.sign({
        subjectId: rotated.subjectId,
        sessionId: rotated.familyId,
      });
      return { access, refresh: rotated, client: rotated.client };
    },

    async logout(refreshToken) {
      if (refreshToken !== undefined) {
        await sessions.revokeByRefreshToken(refreshToken);
      }
    },

    getMe: loadActiveCustomer,

    async updateMe(customerId, patch) {
      if (
        patch.preferredLanguage !== undefined &&
        !(await repository.isLanguageActive(db, patch.preferredLanguage))
      ) {
        throw new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Unsupported language.', {
          issues: [{ path: 'preferredLanguage', message: 'Unsupported language' }],
        });
      }
      const updated = await repository.updateCustomerProfile(db, customerId, {
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
        ...(patch.preferredLanguage !== undefined && {
          preferredLanguage: patch.preferredLanguage,
        }),
      });
      if (updated?.status !== ACTIVE_STATUS) throw notFoundCustomer();
      return updated;
    },

    async verifyEmail(token) {
      await db.transaction().execute(async (trx) => {
        const customerId = await repository.consumeOneTimeToken(
          trx,
          'email_verification_tokens',
          hashOpaqueToken(token),
        );
        if (customerId === undefined) throw invalidToken();
        await repository.markEmailVerified(trx, customerId);
      });
    },

    async resendVerification(customerId) {
      const customer = await loadActiveCustomer(customerId);
      if (customer.emailVerifiedAt !== null) return;
      await db.transaction().execute(async (trx) => {
        await queueVerificationEmail(trx, customer);
      });
    },

    async forgotPassword(email) {
      const customer = await repository.findCustomerByEmail(db, email);
      // Same response whether or not the account exists (no account enumeration).
      if (customer?.status !== ACTIVE_STATUS) return;
      const token = generateOpaqueToken();
      await db.transaction().execute(async (trx) => {
        await repository.replaceOneTimeToken(
          trx,
          'password_reset_tokens',
          customer.id,
          hashOpaqueToken(token),
          new Date(Date.now() + settings.PASSWORD_RESET_TTL_MINUTES * MS_PER_MINUTE),
        );
        await outbox.enqueue(trx, {
          template: 'password_reset',
          recipient: customer.email,
          languageCode: customer.preferredLanguage,
          payload: { fullName: customer.fullName, link: emailLink('/reset-password', token) },
        });
      });
    },

    async resetPassword(token, newPassword) {
      const tokenHash = hashOpaqueToken(token);
      // Check the token and the new password BEFORE consuming it, so a rejected password
      // does not burn the link.
      const customerId = await repository.findValidOneTimeToken(
        db,
        'password_reset_tokens',
        tokenHash,
      );
      if (customerId === undefined) throw invalidToken();
      const customer = await repository.findCustomerById(db, customerId);
      if (customer?.status !== ACTIVE_STATUS) throw invalidToken();
      assertPasswordAllowed({
        password: newPassword,
        email: customer.email,
        minLength: settings.PASSWORD_MIN_LENGTH,
      });
      const passwordHash = await hashPassword(newPassword);

      await db.transaction().execute(async (trx) => {
        const consumedBy = await repository.consumeOneTimeToken(
          trx,
          'password_reset_tokens',
          tokenHash,
        );
        if (consumedBy !== customer.id) throw invalidToken();
        await repository.updatePassword(trx, customer.id, passwordHash);
        await sessions.revokeAllForSubject(trx, customer.id, 'password_reset');
      });
    },
  };
}
