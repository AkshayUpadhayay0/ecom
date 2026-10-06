import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import type { EmailPayload, EmailTemplate } from './email-templates.js';

export interface NewOutboxEmail {
  template: EmailTemplate;
  recipient: string;
  languageCode: string;
  payload: EmailPayload;
  orderId?: string;
}

export interface OutboxEmail {
  id: string;
  template: string;
  recipient: string;
  languageCode: string;
  payload: unknown;
  attempts: number;
}

export interface EmailOutboxRepository {
  enqueue(db: Database, email: NewOutboxEmail): Promise<void>;
  /** Locks due rows; concurrent workers skip each other's rows. Call inside a transaction. */
  claimDue(trx: Database, limit: number): Promise<OutboxEmail[]>;
  markSent(trx: Database, id: string, scrubPayload: boolean): Promise<void>;
  markFailed(
    trx: Database,
    id: string,
    error: string,
    nextAttemptAt: Date,
    giveUp: boolean,
  ): Promise<void>;
}

const MAX_ERROR_LENGTH = 1000;

export function createEmailOutboxRepository(): EmailOutboxRepository {
  return {
    async enqueue(db, email) {
      await db
        .insertInto('email_outbox')
        .values({
          template: email.template,
          recipient: email.recipient,
          language_code: email.languageCode,
          payload: JSON.stringify(email.payload),
          order_id: email.orderId ?? null,
        })
        .execute();
    },

    async claimDue(trx, limit) {
      return trx
        .selectFrom('email_outbox')
        .select([
          'id',
          'template',
          'recipient',
          'language_code as languageCode',
          'payload',
          'attempts',
        ])
        .where('status', '=', 'queued')
        .where('next_attempt_at', '<=', sql<Date>`now()`)
        .orderBy('next_attempt_at')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
    },

    async markSent(trx, id, scrubPayload) {
      await trx
        .updateTable('email_outbox')
        .set({
          status: 'sent',
          sent_at: sql`now()`,
          attempts: sql`attempts + 1`,
          last_error: null,
          ...(scrubPayload && { payload: JSON.stringify({ scrubbed: true }) }),
        })
        .where('id', '=', id)
        .execute();
    },

    async markFailed(trx, id, error, nextAttemptAt, giveUp) {
      await trx
        .updateTable('email_outbox')
        .set({
          status: giveUp ? 'failed' : 'queued',
          attempts: sql`attempts + 1`,
          last_error: error.slice(0, MAX_ERROR_LENGTH),
          next_attempt_at: nextAttemptAt,
        })
        .where('id', '=', id)
        .execute();
    },
  };
}
