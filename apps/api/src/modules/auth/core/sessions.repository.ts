import { sql } from 'kysely';
import type { Database } from '../../../db/database.js';

export type SubjectType = 'customer' | 'admin';
export type SessionClient = 'web' | 'ios' | 'android';
export type RevokeReason =
  'logout' | 'rotated' | 'reuse_detected' | 'password_changed' | 'password_reset' | 'admin';

export interface NewSession {
  familyId: string;
  subjectType: SubjectType;
  subjectId: string;
  tokenHash: string;
  client: SessionClient;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export interface SessionRow {
  id: string;
  familyId: string;
  subjectType: SubjectType;
  subjectId: string;
  client: SessionClient;
  revokedReason: string | null;
}

const SESSION_COLUMNS = [
  'id',
  'family_id as familyId',
  'subject_type as subjectType',
  'subject_id as subjectId',
  'client',
  'revoked_reason as revokedReason',
] as const;

/** Narrows the CHECK-constrained text columns to their unions. */
function toSessionRow(row: {
  id: string;
  familyId: string;
  subjectType: string;
  subjectId: string;
  client: string;
  revokedReason: string | null;
}): SessionRow {
  return {
    ...row,
    subjectType: row.subjectType as SubjectType,
    client: row.client as SessionClient,
  };
}

export interface SessionsRepository {
  insert(db: Database, session: NewSession): Promise<string>;
  /**
   * Atomically revokes the live session with this token hash (row lock + conditional UPDATE),
   * so two concurrent refreshes with the same token cannot both succeed.
   */
  revokeLiveByTokenHash(
    db: Database,
    tokenHash: string,
    subjectType: SubjectType,
    reason: RevokeReason,
  ): Promise<SessionRow | undefined>;
  findByTokenHash(db: Database, tokenHash: string): Promise<SessionRow | undefined>;
  setReplacedBy(db: Database, id: string, replacedBy: string): Promise<void>;
  revokeFamily(db: Database, familyId: string, reason: RevokeReason): Promise<number>;
  revokeAllForSubject(
    db: Database,
    subjectType: SubjectType,
    subjectId: string,
    reason: RevokeReason,
    exceptFamilyId?: string,
  ): Promise<number>;
  isFamilyLive(db: Database, familyId: string, subjectType: SubjectType): Promise<boolean>;
}

export function createSessionsRepository(): SessionsRepository {
  return {
    async insert(db, s) {
      const row = await db
        .insertInto('auth_sessions')
        .values({
          family_id: s.familyId,
          subject_type: s.subjectType,
          subject_id: s.subjectId,
          token_hash: s.tokenHash,
          client: s.client,
          user_agent: s.userAgent,
          ip_address: s.ipAddress,
          expires_at: s.expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async revokeLiveByTokenHash(db, tokenHash, subjectType, reason) {
      const row = await db
        .updateTable('auth_sessions')
        .set({ revoked_at: sql`now()`, revoked_reason: reason, last_used_at: sql`now()` })
        .where('token_hash', '=', tokenHash)
        .where('subject_type', '=', subjectType)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .returning(SESSION_COLUMNS)
        .executeTakeFirst();
      return row && toSessionRow(row);
    },

    async findByTokenHash(db, tokenHash) {
      const row = await db
        .selectFrom('auth_sessions')
        .select(SESSION_COLUMNS)
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row && toSessionRow(row);
    },

    async setReplacedBy(db, id, replacedBy) {
      await db
        .updateTable('auth_sessions')
        .set({ replaced_by: replacedBy })
        .where('id', '=', id)
        .execute();
    },

    async revokeFamily(db, familyId, reason) {
      const result = await db
        .updateTable('auth_sessions')
        .set({ revoked_at: sql`now()`, revoked_reason: reason })
        .where('family_id', '=', familyId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    async revokeAllForSubject(db, subjectType, subjectId, reason, exceptFamilyId) {
      let query = db
        .updateTable('auth_sessions')
        .set({ revoked_at: sql`now()`, revoked_reason: reason })
        .where('subject_type', '=', subjectType)
        .where('subject_id', '=', subjectId)
        .where('revoked_at', 'is', null);
      if (exceptFamilyId !== undefined) {
        query = query.where('family_id', '!=', exceptFamilyId);
      }
      const result = await query.executeTakeFirst();
      return Number(result.numUpdatedRows);
    },

    async isFamilyLive(db, familyId, subjectType) {
      const row = await db
        .selectFrom('auth_sessions')
        .select('id')
        .where('family_id', '=', familyId)
        .where('subject_type', '=', subjectType)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
