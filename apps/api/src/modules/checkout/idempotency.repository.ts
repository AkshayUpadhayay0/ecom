import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface IdempotencyRecord {
  requestHash: string;
  /** Set once the first request completed (e.g. { orderId }). */
  responseBody: unknown;
}

/** idempotency_keys: one row per (scope, key, customer); the request hash detects key reuse. */
export interface IdempotencyRepository {
  /**
   * Inserts the key or, if it already exists, returns the stored record (waiting for a concurrent
   * first request to finish thanks to the unique index). `created` tells which happened.
   */
  claim(
    db: Database,
    input: { scope: string; key: string; subjectId: string; requestHash: string },
  ): Promise<{ created: boolean; record: IdempotencyRecord }>;
  complete(
    db: Database,
    input: { scope: string; key: string; subjectId: string; status: number; body: unknown },
  ): Promise<void>;
  /** Forgets a claim whose work failed outside a transaction, so the key can be retried. */
  release(db: Database, input: { scope: string; key: string; subjectId: string }): Promise<void>;
}

export function createIdempotencyRepository(): IdempotencyRepository {
  return {
    async claim(db, input) {
      const inserted = await sql<{ id: string }>`
        INSERT INTO idempotency_keys (scope, idem_key, subject_id, request_hash)
        VALUES (${input.scope}, ${input.key}, ${input.subjectId}, ${input.requestHash})
        ON CONFLICT (scope, idem_key, subject_id) DO NOTHING
        RETURNING id`.execute(db);
      if (inserted.rows.length > 0) {
        return { created: true, record: { requestHash: input.requestHash, responseBody: null } };
      }
      const row = await db
        .selectFrom('idempotency_keys')
        .select(['request_hash as requestHash', 'response_body as responseBody'])
        .where('scope', '=', input.scope)
        .where('idem_key', '=', input.key)
        .where('subject_id', '=', input.subjectId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      return { created: false, record: row };
    },

    async complete(db, input) {
      await db
        .updateTable('idempotency_keys')
        .set({ response_status: input.status, response_body: JSON.stringify(input.body) })
        .where('scope', '=', input.scope)
        .where('idem_key', '=', input.key)
        .where('subject_id', '=', input.subjectId)
        .execute();
    },

    async release(db, input) {
      await db
        .deleteFrom('idempotency_keys')
        .where('scope', '=', input.scope)
        .where('idem_key', '=', input.key)
        .where('subject_id', '=', input.subjectId)
        .execute();
    },
  };
}
