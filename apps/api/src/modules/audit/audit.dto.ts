import type { AuditLogDto } from '@urban-ibile/shared';
import type { AuditLogRow } from './audit-log.repository.js';

export function toAuditLogDto(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    admin: { id: row.adminId, email: row.adminEmail, displayName: row.adminDisplayName },
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.beforeData,
    after: row.afterData,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}
