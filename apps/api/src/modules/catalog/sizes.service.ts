import type {
  CreateSizeRequest,
  ListSizesQuery,
  SizeDto,
  UpdateSizeRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, alreadyExistsError, notFoundError } from '../../lib/errors.js';
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
  create(actor: AuditActor, input: CreateSizeRequest): Promise<SizeDto>;
  /** Deactivate with `{ isActive: false }`; sizes are never deleted. */
  update(actor: AuditActor, id: string, input: UpdateSizeRequest): Promise<SizeDto>;
  /** `ids` must list every size exactly once. Returns the sizes in their new order. */
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

    async create(actor, input) {
      return db.transaction().execute(async (trx) => {
        const row = await repository.insert(trx, input);
        if (!row) throw alreadyExistsError('code', 'A size with this code already exists.');
        const after = toSizeDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'size.create',
          entityType: ENTITY,
          entityId: row.id,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async update(actor, id, input) {
      return db.transaction().execute(async (trx) => {
        const before = await repository.findById(trx, id, true);
        if (!before) throw notFoundError('Size');
        const row = await repository.update(trx, id, {
          ...(input.label !== undefined && { label: input.label }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        });
        if (!row) throw notFoundError('Size');
        const after = toSizeDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'size.update',
          entityType: ENTITY,
          entityId: id,
          before: toSizeDto(before),
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
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
        const before = await repository.list(trx, { order: 'asc' }, allRows(existing.length));
        await repository.setOrder(trx, ids);
        const after = await repository.list(trx, { order: 'asc' }, allRows(existing.length));
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'size.reorder',
          entityType: ENTITY,
          entityId: 'all',
          before: before.rows.map((row) => row.code),
          after: after.rows.map((row) => row.code),
          ipAddress: actor.ipAddress,
        });
        return after.rows.map(toSizeDto);
      });
    },
  };
}

/** One page holding every row (sizes are a short reference list). */
function allRows(count: number): { page: number; pageSize: number; offset: number } {
  return { page: 1, pageSize: Math.max(count, 1), offset: 0 };
}
