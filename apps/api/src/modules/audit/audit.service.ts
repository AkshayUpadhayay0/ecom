import type { AuditLogDto, ListAuditLogsQuery } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import type { SettingsService } from '../settings/settings.service.js';
import { listAuditLogs } from './audit-log.repository.js';
import { toAuditLogDto } from './audit.dto.js';

export interface AuditService {
  list(query: ListAuditLogsQuery): Promise<Page<AuditLogDto>>;
}

export interface AuditServiceDeps {
  db: Database;
  settings: SettingsService;
}

export function createAuditService({ db, settings }: AuditServiceDeps): AuditService {
  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await listAuditLogs(
        db,
        {
          entityType: query.entityType,
          entityId: query.entityId,
          adminId: query.adminId,
          action: query.action,
          from: query.from === undefined ? undefined : new Date(query.from),
          to: query.to === undefined ? undefined : new Date(query.to),
          order: query.order ?? 'desc',
        },
        page,
      );
      return { items: rows.map(toAuditLogDto), meta: toPageMeta(page, total) };
    },
  };
}
