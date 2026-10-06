import type { Database } from '../../db/database.js';

export interface AuditLogEntry {
  adminId: string;
  /** Dotted verb, e.g. 'product.update', 'order.status_change', 'admin.password_change'. */
  action: string;
  entityType: string;
  entityId: string;
  /** JSON-serialisable snapshots. Never include password hashes or tokens. */
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * Writes one admin_audit_logs row. Every admin write must call this with the SAME transaction
 * as the change it records, so the change and its audit entry commit or roll back together.
 */
export async function writeAuditLog(trx: Database, entry: AuditLogEntry): Promise<void> {
  await trx
    .insertInto('admin_audit_logs')
    .values({
      admin_id: entry.adminId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before_data: toJson(entry.before),
      after_data: toJson(entry.after),
      ip_address: entry.ipAddress ?? null,
    })
    .execute();
}
