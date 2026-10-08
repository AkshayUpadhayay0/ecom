import type {
  ClothingTypeDto,
  CreateClothingTypeRequest,
  ListClothingTypesQuery,
  UpdateClothingTypeRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { alreadyExistsError, notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import {
  splitTranslationPatch,
  type TranslationsService,
} from '../localization/translations.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toClothingTypeDto } from './catalog.dto.js';
import type { ClothingTypesRepository } from './clothing-types.repository.js';

const ENTITY = 'clothing_type';

export interface ClothingTypesService {
  list(query: ListClothingTypesQuery): Promise<Page<ClothingTypeDto>>;
  get(id: string): Promise<ClothingTypeDto>;
  create(actor: AuditActor, input: CreateClothingTypeRequest): Promise<ClothingTypeDto>;
  /** Deactivate with `{ isActive: false }`; clothing types are never deleted. */
  update(actor: AuditActor, id: string, input: UpdateClothingTypeRequest): Promise<ClothingTypeDto>;
}

export interface ClothingTypesServiceDeps {
  db: Database;
  repository: ClothingTypesRepository;
  translations: TranslationsService;
  settings: SettingsService;
}

function slugTaken(): Error {
  return alreadyExistsError('slug', 'Another clothing type already uses this slug.');
}

export function createClothingTypesService(deps: ClothingTypesServiceDeps): ClothingTypesService {
  const { db, repository, translations, settings } = deps;

  async function load(executor: Database, id: string, lock = false): Promise<ClothingTypeDto> {
    const row = await repository.findById(executor, id, lock);
    if (!row) throw notFoundError('Clothing type');
    return toClothingTypeDto(row);
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(
        db,
        { q: query.q, isActive: query.isActive, sort: query.sort, order: query.order ?? 'asc' },
        page,
      );
      return { items: rows.map(toClothingTypeDto), meta: toPageMeta(page, total) };
    },

    async get(id) {
      return load(db, id);
    },

    async create(actor, input) {
      await translations.assertValid(db, input.translations, { requireDefault: true });
      return db.transaction().execute(async (trx) => {
        const id = await repository.insert(trx, {
          slug: input.slug,
          searchKeywords: input.searchKeywords,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        });
        if (id === undefined) throw slugTaken();
        await repository.upsertNames(
          trx,
          id,
          Object.fromEntries(Object.entries(input.translations).map(([code, t]) => [code, t.name])),
        );
        const after = await load(trx, id);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'clothing_type.create',
          entityType: ENTITY,
          entityId: id,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async update(actor, id, input) {
      if (input.translations) {
        await translations.assertValid(db, input.translations, { requireDefault: false });
      }
      return db.transaction().execute(async (trx) => {
        const before = await load(trx, id, true);
        const updated = await repository.update(trx, id, {
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.searchKeywords !== undefined && { searchKeywords: input.searchKeywords }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        });
        if (!updated) throw slugTaken();
        if (input.translations) {
          const { upserts, removals } = splitTranslationPatch(input.translations);
          await repository.upsertNames(
            trx,
            id,
            Object.fromEntries(Object.entries(upserts).map(([code, t]) => [code, t.name])),
          );
          await repository.deleteNames(trx, id, removals);
        }
        const after = await load(trx, id);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'clothing_type.update',
          entityType: ENTITY,
          entityId: id,
          before,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },
  };
}
