import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Database } from '../../../db/database.js';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token.js';
import type {
  RevokeReason,
  SessionClient,
  SessionsRepository,
  SubjectType,
} from './sessions.repository.js';

export interface ClientContext {
  client: SessionClient;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface IssuedRefreshToken {
  refreshToken: string;
  expiresAt: Date;
  familyId: string;
}

export interface RotatedSession extends IssuedRefreshToken {
  subjectId: string;
  client: SessionClient;
}

export interface SessionService {
  /** Starts a new session family (login / register). Pass a transaction to join it. */
  start(db: Database, subjectId: string, ctx: ClientContext): Promise<IssuedRefreshToken>;
  /**
   * Exchanges a refresh token for a new one in the same family. Presenting a token that was
   * already rotated revokes the whole family (token theft signal).
   */
  rotate(refreshToken: string, ctx: Omit<ClientContext, 'client'>): Promise<RotatedSession>;
  /** Revokes the family of this refresh token. Unknown tokens are ignored (idempotent logout). */
  revokeByRefreshToken(refreshToken: string): Promise<void>;
  revokeAllForSubject(
    db: Database,
    subjectId: string,
    reason: RevokeReason,
    exceptFamilyId?: string,
  ): Promise<number>;
  isFamilyLive(familyId: string): Promise<boolean>;
}

export interface SessionServiceDeps {
  db: Database;
  repository: SessionsRepository;
  logger: Logger;
  subjectType: SubjectType;
  refreshTtlMs: number;
  /** Re-checked on every refresh so suspended accounts lose access at the next rotation. */
  isSubjectActive: (db: Database, subjectId: string) => Promise<boolean>;
}

type RotationOutcome =
  | { kind: 'rotated'; session: RotatedSession }
  | { kind: 'not_live' }
  | { kind: 'subject_inactive'; familyId: string };

function invalidRefreshToken(): AppError {
  return new AppError('UNAUTHENTICATED', HTTP_STATUS.UNAUTHORIZED, 'Sign in again.');
}

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { db, repository, subjectType } = deps;

  async function insertSession(
    executor: Database,
    familyId: string,
    subjectId: string,
    ctx: ClientContext,
  ): Promise<IssuedRefreshToken & { id: string }> {
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + deps.refreshTtlMs);
    const id = await repository.insert(executor, {
      familyId,
      subjectType,
      subjectId,
      tokenHash: hashOpaqueToken(refreshToken),
      client: ctx.client,
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
      expiresAt,
    });
    return { id, refreshToken, expiresAt, familyId };
  }

  return {
    async start(executor, subjectId, ctx) {
      const { refreshToken, expiresAt, familyId } = await insertSession(
        executor,
        randomUUID(),
        subjectId,
        ctx,
      );
      return { refreshToken, expiresAt, familyId };
    },

    async rotate(refreshToken, ctx) {
      const tokenHash = hashOpaqueToken(refreshToken);

      const outcome = await db.transaction().execute(async (trx): Promise<RotationOutcome> => {
        const current = await repository.revokeLiveByTokenHash(
          trx,
          tokenHash,
          subjectType,
          'rotated',
        );
        if (!current) return { kind: 'not_live' };
        if (!(await deps.isSubjectActive(trx, current.subjectId))) {
          return { kind: 'subject_inactive', familyId: current.familyId };
        }
        const next = await insertSession(trx, current.familyId, current.subjectId, {
          ...ctx,
          client: current.client,
        });
        await repository.setReplacedBy(trx, current.id, next.id);
        return {
          kind: 'rotated',
          session: {
            refreshToken: next.refreshToken,
            expiresAt: next.expiresAt,
            familyId: next.familyId,
            subjectId: current.subjectId,
            client: current.client,
          },
        };
      });

      if (outcome.kind === 'rotated') return outcome.session;

      if (outcome.kind === 'subject_inactive') {
        await repository.revokeFamily(db, outcome.familyId, 'admin');
        throw invalidRefreshToken();
      }

      // Not live: unknown, expired, logged out - or a replay of an already-rotated token.
      const previous = await repository.findByTokenHash(db, tokenHash);
      if (previous?.subjectType === subjectType && previous.revokedReason === 'rotated') {
        const revoked = await repository.revokeFamily(db, previous.familyId, 'reuse_detected');
        deps.logger.warn(
          { subjectType, subjectId: previous.subjectId, familyId: previous.familyId, revoked },
          'refresh token reuse detected; session family revoked',
        );
      }
      throw invalidRefreshToken();
    },

    async revokeByRefreshToken(refreshToken) {
      const session = await repository.findByTokenHash(db, hashOpaqueToken(refreshToken));
      if (session?.subjectType === subjectType) {
        await repository.revokeFamily(db, session.familyId, 'logout');
      }
    },

    revokeAllForSubject(executor, subjectId, reason, exceptFamilyId) {
      return repository.revokeAllForSubject(
        executor,
        subjectType,
        subjectId,
        reason,
        exceptFamilyId,
      );
    },

    isFamilyLive(familyId) {
      return repository.isFamilyLive(db, familyId, subjectType);
    },
  };
}
