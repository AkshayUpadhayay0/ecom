import type { ListSizesQuery, SizeDto } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toSizeDto } from './catalog.dto.js';
import type { SizesRepository } from './sizes.repository.js';

const ENTITY = 'size';

export interface SizesService {
  list(query: ListSizesQuery): Promise<Page<SizeDto>>;
  get(id: string): Promise<SizeDto>;
  /**
   * `ids` must list every size exactly once. Returns the sizes in their new order.
   * WARNING: Blueprint picks the "largest required size" by sizes.sort_order, so a reorder
   * changes fitting recommendations. Keep sizes inside each chart in ascending order.
   */
  reorder(actor: AuditActor, ids: string[]): Promise<SizeDto[]>;
}

export interface SizesServiceDeps {
  db: Database;
  repository: SizesRepository;
  settings: SettingsService;
}

export function createSizesService({ db, repository, settings }: SizesServiceDeps): SizesService {
  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(
        db,
        { isActive: query.isActive, order: query.order ?? 'asc' },
        page,
      );
      return { items: rows.map(toSizeDto), meta: toPageMeta(page, total) };
    },

    async get(id) {
      const row = await repository.findById(db, id);
      if (!row) throw notFoundError('Size');
      return toSizeDto(row);
    },

    async reorder(actor, ids) {
      return db.transaction().execute(async (trx) => {
        const existing = await repository.lockAllIds(trx);
        const known = new Set(existing);
        const missing = existing.filter((id) => !ids.includes(id));
        const unknown = ids.filter((id) => !known.has(id));
        if (missing.length > 0 || unknown.length > 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            HTTP_STATUS.BAD_REQUEST,
            'ids must list every size exactly once.',
            { missing, unknown },
          );
        }
        const before = await repository.listAll(trx);
        await repository.setOrder(trx, ids);
        const after = await repository.listAll(trx);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'size.reorder',
          entityType: ENTITY,
          entityId: 'all',
          before: before.map((row) => row.code),
          after: after.map((row) => row.code),
          ipAddress: actor.ipAddress,
        });
        return after.map(toSizeDto);
      });
    },
  };
}
