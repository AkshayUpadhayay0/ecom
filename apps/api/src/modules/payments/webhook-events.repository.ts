import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

const PROVIDER = 'paystack';
const MAX_ERROR_LENGTH = 1000;

/** Inbox of provider webhooks; UNIQUE (provider, provider_event_key) makes repeats no-ops. */
export interface WebhookEventsRepository {
  /** 'stored' = first delivery (process it); 'duplicate' = already received. */
  store(
    db: Database,
    event: { eventKey: string; eventType: string; reference: string | null; payload: unknown },
  ): Promise<{ outcome: 'stored'; id: string } | { outcome: 'duplicate' }>;
  markProcessed(db: Database, id: string, error: string | null): Promise<void>;
}

export function createWebhookEventsRepository(): WebhookEventsRepository {
  return {
    async store(db, event) {
      const row = await db
        .insertInto('payment_webhook_events')
        .values({
          provider: PROVIDER,
          provider_event_key: event.eventKey,
          event_type: event.eventType,
          reference: event.reference,
          // Only signature-valid events are stored (invalid ones are logged and refused).
          signature_valid: true,
          payload: JSON.stringify(event.payload),
        })
        .onConflict((oc) => oc.columns(['provider', 'provider_event_key']).doNothing())
        .returning('id')
        .executeTakeFirst();
      return row ? { outcome: 'stored', id: row.id } : { outcome: 'duplicate' };
    },

    async markProcessed(db, id, error) {
      await db
        .updateTable('payment_webhook_events')
        .set({
          processed_at: error === null ? sql`now()` : null,
          processing_error: error?.slice(0, MAX_ERROR_LENGTH) ?? null,
        })
        .where('id', '=', id)
        .execute();
    },
  };
}
