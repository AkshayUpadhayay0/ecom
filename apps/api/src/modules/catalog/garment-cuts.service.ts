import type {
  CreateGarmentCutRequest,
  GarmentCutDto,
  ListGarmentCutsQuery,
  UpdateGarmentCutRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { alreadyExistsError, notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toGarmentCutDto } from './catalog.dto.js';
import type { GarmentCutsRepository } from './garment-cuts.repository.js';

const ENTITY = 'garment_cut';

export interface GarmentCutsService {
  list(query: ListGarmentCutsQuery): Promise<Page<GarmentCutDto>>;
  get(id: string): Promise<GarmentCutDto>;
  create(actor: AuditActor, input: CreateGarmentCutRequest): Promise<GarmentCutDto>;
  /** Deactivate with `{ isActive: false }`; garment cuts are never deleted. */
  update(actor: AuditActor, id: string, input: UpdateGarmentCutRequest): Promise<GarmentCutDto>;
}

export interface GarmentCutsServiceDeps {
  db: Database;
  repository: GarmentCutsRepository;
  settings: SettingsService;
}

export function createGarmentCutsService({
  db,
  repository,
  settings,
}: GarmentCutsServiceDeps): GarmentCutsService {
  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(
        db,
        { q: query.q, isActive: query.isActive, order: query.order ?? 'asc' },
        page,
      );
      return { items: rows.map(toGarmentCutDto), meta: toPageMeta(page, total) };
    },

    async get(id) {
      const row = await repository.findById(db, id);
      if (!row) throw notFoundError('Garment cut');
      return toGarmentCutDto(row);
    },

    async create(actor, input) {
      return db.transaction().execute(async (trx) => {
        const row = await repository.insert(trx, input);
        if (!row) throw alreadyExistsError('code', 'A garment cut with this code already exists.');
        const after = toGarmentCutDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'garment_cut.create',
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
        if (!before) throw notFoundError('Garment cut');
        const row = await repository.update(trx, id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        });
        if (!row) throw notFoundError('Garment cut');
        const after = toGarmentCutDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'garment_cut.update',
          entityType: ENTITY,
          entityId: id,
          before: toGarmentCutDto(before),
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },
  };
}
