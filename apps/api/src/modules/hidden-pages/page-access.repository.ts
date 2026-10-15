import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

/** qr_access_events.outcome values used by the serial flow (CHECK-constrained in the DB). */
export type AccessOutcome =
  | 'INVALID_TOKEN'
  | 'GRANT_VALID'
  | 'PAGE_LOCKED'
  | 'PAGE_SERVED'
  | 'SERIAL_ACCEPTED'
  | 'SERIAL_REJECTED'
  | 'RATE_LIMITED';

export interface AccessEvent {
  pageId: string | null;
  outcome: AccessOutcome;
  serialId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Who is asking: the hashed browser cookie and/or the signed-in customer. */
export interface AccessHolder {
  browserTokenHash: string | null;
  customerId: string | null;
}

export interface NewGrant {
  serialId: string;
  scope: 'PAGE' | 'ALL';
  pageId: string | null;
  browserTokenHash: string;
  customerId: string | null;
}

const USER_AGENT_MAX_LENGTH = 300;

export interface PageAccessRepository {
  /**
   * True if the holder has a live grant for the page: not revoked, not expired, scope ALL or this
   * page, and its serial is still active (deactivating a serial withdraws its access).
   * Touches last_used_at on the matching grants.
   */
  hasAccess(db: Database, holder: AccessHolder, pageId: string): Promise<boolean>;
  /** Inserts the grant unless the same browser already holds an identical live one. */
  grant(db: Database, grant: NewGrant): Promise<void>;
  logEvent(db: Database, event: AccessEvent): Promise<void>;
}

export function createPageAccessRepository(): PageAccessRepository {
  return {
    async hasAccess(db, holder, pageId) {
      if (holder.browserTokenHash === null && holder.customerId === null) return false;
      const result = await sql<{ id: string }>`
        UPDATE page_access_grants AS g SET last_used_at = now()
        FROM serial_numbers AS s
        WHERE s.id = g.serial_id
          AND s.is_active
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at > now())
          AND (g.scope = 'ALL' OR g.page_id = ${pageId}::uuid)
          AND (g.browser_token_hash = ${holder.browserTokenHash}::text
               OR g.customer_id = ${holder.customerId}::uuid)
        RETURNING g.id`.execute(db);
      return result.rows.length > 0;
    },

    async grant(db, grant) {
      await sql`
        INSERT INTO page_access_grants (serial_id, scope, page_id, browser_token_hash, customer_id)
        SELECT ${grant.serialId}::uuid, ${grant.scope}::text, ${grant.pageId}::uuid,
               ${grant.browserTokenHash}::text, ${grant.customerId}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM page_access_grants
          WHERE serial_id = ${grant.serialId}
            AND browser_token_hash = ${grant.browserTokenHash}
            AND page_id IS NOT DISTINCT FROM ${grant.pageId}
            AND customer_id IS NOT DISTINCT FROM ${grant.customerId}
            AND revoked_at IS NULL)`.execute(db);
    },

    async logEvent(db, event) {
      await db
        .insertInto('qr_access_events')
        .values({
          qr_page_id: event.pageId,
          outcome: event.outcome,
          serial_id: event.serialId ?? null,
          ip_address: event.ipAddress,
          user_agent: event.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
        })
        .execute();
    },
  };
}
