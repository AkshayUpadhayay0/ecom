import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

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

export interface AuditLogFilters {
  entityType?: string | undefined;
  entityId?: string | undefined;
  adminId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  order: 'asc' | 'desc';
}

export interface AuditLogRow {
  id: string;
  adminId: string;
  adminEmail: string;
  adminDisplayName: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: unknown;
  afterData: unknown;
  ipAddress: string | null;
  createdAt: Date;
}

export async function listAuditLogs(
  db: Database,
  filters: AuditLogFilters,
  page: PageRequest,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  let query = db
    .selectFrom('admin_audit_logs as l')
    .innerJoin('admin_users as a', 'a.id', 'l.admin_id');
  if (filters.entityType !== undefined)
    query = query.where('l.entity_type', '=', filters.entityType);
  if (filters.entityId !== undefined) query = query.where('l.entity_id', '=', filters.entityId);
  if (filters.adminId !== undefined) query = query.where('l.admin_id', '=', filters.adminId);
  if (filters.action !== undefined) query = query.where('l.action', '=', filters.action);
  if (filters.from !== undefined) query = query.where('l.created_at', '>=', filters.from);
  if (filters.to !== undefined) query = query.where('l.created_at', '<', filters.to);

  const [rows, count] = await Promise.all([
    query
      .select([
        'l.id',
        'l.admin_id as adminId',
        'a.email as adminEmail',
        'a.display_name as adminDisplayName',
        'l.action',
        'l.entity_type as entityType',
        'l.entity_id as entityId',
        'l.before_data as beforeData',
        'l.after_data as afterData',
        'l.ip_address as ipAddress',
        'l.created_at as createdAt',
      ])
      .orderBy('l.created_at', filters.order)
      .orderBy('l.id', filters.order)
      .limit(page.pageSize)
      .offset(page.offset)
      .execute(),
    query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
  ]);
  return { rows, total: Number(count.total) };
}
