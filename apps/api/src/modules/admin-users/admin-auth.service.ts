import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { AccessTokens, SignedAccessToken } from '../auth/core/access-tokens.js';
import {
  invalidCredentials,
  verifyLoginWithLockout,
  type LockoutPolicy,
} from '../auth/core/lockout.js';
import { assertPasswordAllowed, hashPassword, verifyPassword } from '../auth/core/passwords.js';
import type { AdminPrincipal } from '../auth/core/principals.js';
import type {
  ClientContext,
  IssuedRefreshToken,
  SessionService,
} from '../auth/core/sessions.service.js';
import type { AdminRole, AdminRow, AdminUsersRepository } from './admin-users.repository.js';
import { writeAuditLog } from './audit-log.repository.js';

/** The admin panel is a browser app. */
const ADMIN_CLIENT = 'web';

export interface AdminSession {
  admin: AdminRow;
  access: SignedAccessToken;
  refresh: IssuedRefreshToken;
}

export interface NewAdminInput {
  email: string;
  displayName: string;
  password: string;
  role: AdminRole;
}

export interface AdminAuthService {
  login(email: string, password: string, ctx: Omit<ClientContext, 'client'>): Promise<AdminSession>;
  refresh(
    refreshToken: string,
    ctx: Omit<ClientContext, 'client'>,
  ): Promise<{ access: SignedAccessToken; refresh: IssuedRefreshToken }>;
  logout(refreshToken: string | undefined): Promise<void>;
  /** Verifies the token AND that the session and account are still live (used by requireAdmin). */
  authenticate(accessToken: string): Promise<AdminPrincipal>;
  getMe(adminId: string): Promise<AdminRow>;
  changePassword(
    principal: AdminPrincipal,
    currentPassword: string,
    newPassword: string,
    ipAddress: string | null,
  ): Promise<void>;
  /** Used by the `pnpm admin:create` CLI. */
  createAdmin(input: NewAdminInput): Promise<AdminRow>;
}

export interface AdminAuthServiceDeps {
  db: Database;
  repository: AdminUsersRepository;
  sessions: SessionService;
  accessTokens: AccessTokens;
  lockoutPolicy: LockoutPolicy;
  passwordMinLength: number;
}

function unauthenticated(): AppError {
  return new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in required.');
}

export function createAdminAuthService(deps: AdminAuthServiceDeps): AdminAuthService {
  const { db, repository, sessions, accessTokens } = deps;

  async function loadActiveAdmin(adminId: string): Promise<AdminRow> {
    const admin = await repository.findById(db, adminId);
    if (!admin?.isActive) throw unauthenticated();
    return admin;
  }

  return {
    async login(email, password, ctx) {
      const admin = await repository.findByEmail(db, email);
      await verifyLoginWithLockout(
        db,
        'admin_users',
        admin && {
          id: admin.id,
          passwordHash: admin.passwordHash,
          lockedUntil: admin.lockedUntil,
          isActive: admin.isActive,
        },
        password,
        deps.lockoutPolicy,
      );
      if (!admin) throw invalidCredentials(); // unreachable: verifyLoginWithLockout threw
      const refresh = await sessions.start(db, admin.id, { ...ctx, client: ADMIN_CLIENT });
      const access = await accessTokens.sign({ subjectId: admin.id, sessionId: refresh.familyId });
      return { admin, access, refresh };
    },

    async refresh(refreshToken, ctx) {
      const rotated = await sessions.rotate(refreshToken, ctx);
      const access = await accessTokens.sign({
        subjectId: rotated.subjectId,
        sessionId: rotated.familyId,
      });
      return { access, refresh: rotated };
    },

    async logout(refreshToken) {
      if (refreshToken !== undefined) {
        await sessions.revokeByRefreshToken(refreshToken);
      }
    },

    async authenticate(accessToken) {
      const claims = await accessTokens.verify(accessToken);
      if (!(await sessions.isFamilyLive(claims.sessionId))) throw unauthenticated();
      const admin = await loadActiveAdmin(claims.subjectId);
      return {
        id: admin.id,
        sessionId: claims.sessionId,
        email: admin.email,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword,
      };
    },

    getMe: loadActiveAdmin,

    async changePassword(principal, currentPassword, newPassword, ipAddress) {
      const admin = await loadActiveAdmin(principal.id);
      if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
        throw new AppError(
          'INVALID_CREDENTIALS',
          HTTP_STATUS.BAD_REQUEST,
          'Current password is incorrect.',
        );
      }
      if (currentPassword === newPassword) {
        throw new AppError('WEAK_PASSWORD', HTTP_STATUS.BAD_REQUEST, 'Choose a new password.', {
          reasons: ['The new password must differ from the current one.'],
        });
      }
      assertPasswordAllowed({
        password: newPassword,
        email: admin.email,
        minLength: deps.passwordMinLength,
      });
      const passwordHash = await hashPassword(newPassword);

      await db.transaction().execute(async (trx) => {
        await repository.updatePassword(trx, admin.id, passwordHash);
        // Sign out every other device; the current session stays signed in.
        const revokedSessions = await sessions.revokeAllForSubject(
          trx,
          admin.id,
          'password_changed',
          principal.sessionId,
        );
        await writeAuditLog(trx, {
          adminId: admin.id,
          action: 'admin.password_change',
          entityType: 'admin_user',
          entityId: admin.id,
          before: { mustChangePassword: admin.mustChangePassword },
          after: { mustChangePassword: false, revokedSessions },
          ipAddress,
        });
      });
    },

    async createAdmin(input) {
      assertPasswordAllowed({
        password: input.password,
        email: input.email,
        minLength: deps.passwordMinLength,
      });
      const created = await repository.insert(db, {
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        passwordHash: await hashPassword(input.password),
      });
      if (!created) {
        throw new AppError(
          'EMAIL_ALREADY_REGISTERED',
          HTTP_STATUS.CONFLICT,
          'An admin with this email already exists.',
        );
      }
      return created;
    },
  };
}
