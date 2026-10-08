import type {
  CreateProductRequest,
  ListProductsQuery,
  ProductDto,
  ProductStatus,
  ProductSummaryDto,
  UpdateProductRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, alreadyExistsError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import {
  splitTranslationPatch,
  type TranslationsService,
} from '../localization/translations.service.js';
import type { MediaAssetsService } from '../media/media-assets.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toProductDto, toProductSummaryDto } from './catalog.dto.js';
import type { ClothingTypesRepository } from './clothing-types.repository.js';
import type { GarmentCutsRepository } from './garment-cuts.repository.js';
import type { ProductsRepository } from './products.repository.js';

const ENTITY = 'product';
const ACTIVE: ProductStatus = 'active';
const ARCHIVED: ProductStatus = 'archived';

export interface ProductsService {
  list(query: ListProductsQuery): Promise<Page<ProductSummaryDto>>;
  get(id: string): Promise<ProductDto>;
  create(actor: AuditActor, input: CreateProductRequest): Promise<ProductDto>;
  /**
   * Edits details and price. Existing orders are unaffected: they keep their own price/name
   * snapshots. Archived products must be restored (status change) before editing.
   */
  update(actor: AuditActor, id: string, input: UpdateProductRequest): Promise<ProductDto>;
  /** draft / active / inactive / archived. Products are archived, never deleted. */
  changeStatus(actor: AuditActor, id: string, status: ProductStatus): Promise<ProductDto>;
  /** Points the product at an existing, ready video asset (uploads are Phase 3). */
  setVideo(actor: AuditActor, id: string, mediaAssetId: string): Promise<ProductDto>;
}

export interface ProductsServiceDeps {
  db: Database;
  repository: ProductsRepository;
  clothingTypes: ClothingTypesRepository;
  garmentCuts: GarmentCutsRepository;
  translations: TranslationsService;
  media: MediaAssetsService;
  settings: SettingsService;
}

function slugTaken(): AppError {
  return alreadyExistsError('slug', 'Another product already uses this slug.');
}

function descriptionsOf(
  translations: Readonly<Record<string, { description: string }>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(translations).map(([code, t]) => [code, t.description]));
}

export function createProductsService(deps: ProductsServiceDeps): ProductsService {
  const { db, repository, translations, settings } = deps;

  async function load(executor: Database, id: string, lock = false): Promise<ProductDto> {
    const row = await repository.findById(executor, id, lock);
    if (!row) throw notFoundError('Product');
    return toProductDto(row, await repository.descriptionsFor(executor, id));
  }

  async function assertReferences(
    executor: Database,
    refs: { clothingTypeId?: string | undefined; garmentCutId?: string | null | undefined },
  ): Promise<void> {
    if (refs.clothingTypeId !== undefined) {
      const type = await deps.clothingTypes.findById(executor, refs.clothingTypeId);
      if (!type?.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Unknown or inactive clothing type.',
          {
            issues: [{ path: 'clothingTypeId', message: 'Unknown or inactive clothing type.' }],
          },
        );
      }
    }
    if (refs.garmentCutId != null) {
      const cut = await deps.garmentCuts.findById(executor, refs.garmentCutId);
      if (!cut?.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Unknown or inactive garment cut.',
          {
            issues: [{ path: 'garmentCutId', message: 'Unknown or inactive garment cut.' }],
          },
        );
      }
    }
  }

  /** Call inside the transaction, BEFORE locking the product row (consistent lock order). */
  async function assertActiveSlotFree(trx: Database): Promise<void> {
    await repository.lockActiveCap(trx);
    const limit = await settings.getLimit(trx, 'catalog.max_active_products');
    const active = await repository.countActive(trx);
    if (active >= limit) {
      throw new AppError(
        'ACTIVE_PRODUCT_LIMIT_REACHED',
        HTTP_STATUS.CONFLICT,
        `Only ${limit} products can be active at the same time. Deactivate or archive another product first.`,
        { limit, active },
      );
    }
  }

  function assertEditable(product: ProductDto): void {
    if (product.status === ARCHIVED) {
      throw new AppError(
        'INVALID_STATE',
        HTTP_STATUS.CONFLICT,
        'Archived products cannot be edited. Restore it first by changing its status.',
      );
    }
  }

  async function audit(
    trx: Database,
    actor: AuditActor,
    action: string,
    id: string,
    before: ProductDto | undefined,
    after: ProductDto,
  ): Promise<void> {
    await writeAuditLog(trx, {
      adminId: actor.adminId,
      action,
      entityType: ENTITY,
      entityId: id,
      before,
      after,
      ipAddress: actor.ipAddress,
    });
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(
        db,
        {
          q: query.q,
          status: query.status,
          clothingTypeId: query.clothingTypeId,
          garmentCutId: query.garmentCutId,
          sort: query.sort,
          order: query.order ?? 'asc',
        },
        page,
      );
      return { items: rows.map(toProductSummaryDto), meta: toPageMeta(page, total) };
    },

    async get(id) {
      return load(db, id);
    },

    async create(actor, input) {
      await translations.assertValid(db, input.translations, { requireDefault: true });
      return db.transaction().execute(async (trx) => {
        await assertReferences(trx, input);
        if (input.status === ACTIVE) await assertActiveSlotFree(trx);
        const id = await repository.insert(trx, {
          name: input.name,
          slug: input.slug,
          clothingTypeId: input.clothingTypeId,
          garmentCutId: input.garmentCutId,
          priceMinor: input.priceMinor,
          searchKeywords: input.searchKeywords,
          displayOrder: input.displayOrder,
          status: input.status,
        });
        if (id === undefined) throw slugTaken();
        await repository.upsertDescriptions(trx, id, descriptionsOf(input.translations));
        const after = await load(trx, id);
        await audit(trx, actor, 'product.create', id, undefined, after);
        return after;
      });
    },

    async update(actor, id, input) {
      if (input.translations) {
        await translations.assertValid(db, input.translations, { requireDefault: false });
      }
      return db.transaction().execute(async (trx) => {
        const before = await load(trx, id, true);
        assertEditable(before);
        await assertReferences(trx, input);
        const updated = await repository.update(trx, id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.clothingTypeId !== undefined && { clothingTypeId: input.clothingTypeId }),
          ...(input.garmentCutId !== undefined && { garmentCutId: input.garmentCutId }),
          ...(input.priceMinor !== undefined && { priceMinor: input.priceMinor }),
          ...(input.searchKeywords !== undefined && { searchKeywords: input.searchKeywords }),
          ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
        });
        if (!updated) throw slugTaken();
        if (input.translations) {
          const { upserts, removals } = splitTranslationPatch(input.translations);
          await repository.upsertDescriptions(trx, id, descriptionsOf(upserts));
          await repository.deleteDescriptions(trx, id, removals);
        }
        const after = await load(trx, id);
        await audit(trx, actor, 'product.update', id, before, after);
        return after;
      });
    },

    async changeStatus(actor, id, status) {
      return db.transaction().execute(async (trx) => {
        // Advisory lock first, then the row lock: every activation takes them in this order.
        if (status === ACTIVE) await repository.lockActiveCap(trx);
        const before = await load(trx, id, true);
        if (before.status === status) return before;
        if (status === ACTIVE) await assertActiveSlotFree(trx);
        await repository.setStatus(trx, id, status);
        const after = await load(trx, id);
        await audit(trx, actor, 'product.status_change', id, before, after);
        return after;
      });
    },

    async setVideo(actor, id, mediaAssetId) {
      return db.transaction().execute(async (trx) => {
        const before = await load(trx, id, true);
        assertEditable(before);
        await deps.media.assertReadyVideo(trx, mediaAssetId);
        await repository.setVideo(trx, id, mediaAssetId);
        const after = await load(trx, id);
        await audit(trx, actor, 'product.video_replace', id, before, after);
        return after;
      });
    },
  };
}
