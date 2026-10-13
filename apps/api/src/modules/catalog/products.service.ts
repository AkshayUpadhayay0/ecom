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
import type { MeasurementProfilesRepository } from '../blueprint/measurement-profiles.repository.js';
import type { MediaAssetsService } from '../media/media-assets.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toProductDto, toProductSummaryDto } from './catalog.dto.js';
import type { ClothingTypesRepository } from './clothing-types.repository.js';
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
  /** Points the product at an existing ready, public video asset (uploads are Phase 3). */
  setVideo(actor: AuditActor, id: string, mediaAssetId: string): Promise<ProductDto>;
  /** Replaces the product's images with existing ready, public image assets. */
  setImages(actor: AuditActor, id: string, mediaAssetIds: string[]): Promise<ProductDto>;
}

export interface ProductsServiceDeps {
  db: Database;
  repository: ProductsRepository;
  clothingTypes: ClothingTypesRepository;
  measurementProfiles: MeasurementProfilesRepository;
  media: MediaAssetsService;
  settings: SettingsService;
}

function slugTaken(): AppError {
  return alreadyExistsError('slug', 'Another product already uses this slug.');
}

function invalidReference(path: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, message, {
    issues: [{ path, message }],
  });
}

export function createProductsService(deps: ProductsServiceDeps): ProductsService {
  const { db, repository, settings } = deps;

  async function load(executor: Database, id: string, lock = false): Promise<ProductDto> {
    const row = await repository.findById(executor, id, lock);
    if (!row) throw notFoundError('Product');
    const [description, imageAssetIds] = await Promise.all([
      repository.descriptionOf(executor, id),
      repository.imageAssetIds(executor, id),
    ]);
    return toProductDto(row, description, imageAssetIds);
  }

  async function assertReferences(
    executor: Database,
    refs: { clothingTypeId?: string | undefined; measurementProfileId?: string | null | undefined },
  ): Promise<void> {
    if (refs.clothingTypeId !== undefined) {
      const type = await deps.clothingTypes.findById(executor, refs.clothingTypeId);
      if (!type?.isActive) {
        throw invalidReference('clothingTypeId', 'Unknown or inactive clothing type.');
      }
    }
    if (refs.measurementProfileId != null) {
      const profile = await deps.measurementProfiles.findById(executor, refs.measurementProfileId);
      if (!profile?.isActive) {
        throw invalidReference('measurementProfileId', 'Unknown or inactive measurement profile.');
      }
    }
  }

  /**
   * Optional cap (9 Oct design: none by default). Call inside the transaction BEFORE locking the
   * product row so every activation takes the locks in the same order.
   */
  async function assertActiveSlotFree(trx: Database): Promise<void> {
    await repository.lockActiveCap(trx);
    const limit = await settings.getOptionalLimit(trx, 'catalog.max_active_products');
    if (limit === null) return;
    const active = await repository.countActive(trx);
    if (active >= limit) {
      throw new AppError(
        'ACTIVE_PRODUCT_LIMIT_REACHED',
        HTTP_STATUS.CONFLICT,
        `Only ${limit} products can be active at the same time (setting catalog.max_active_products).`,
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

  /** Locks the product, applies `change`, audits before/after in the same transaction. */
  async function mutate(
    actor: AuditActor,
    id: string,
    action: string,
    change: (trx: Database, before: ProductDto) => Promise<void>,
  ): Promise<ProductDto> {
    return db.transaction().execute(async (trx) => {
      const before = await load(trx, id, true);
      assertEditable(before);
      await change(trx, before);
      const after = await load(trx, id);
      await writeAuditLog(trx, {
        adminId: actor.adminId,
        action,
        entityType: ENTITY,
        entityId: id,
        before,
        after,
        ipAddress: actor.ipAddress,
      });
      return after;
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
          measurementProfileId: query.measurementProfileId,
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
      return db.transaction().execute(async (trx) => {
        await assertReferences(trx, input);
        if (input.status === ACTIVE) await assertActiveSlotFree(trx);
        const id = await repository.insert(trx, {
          name: input.name,
          slug: input.slug,
          clothingTypeId: input.clothingTypeId,
          measurementProfileId: input.measurementProfileId,
          priceMinor: input.priceMinor,
          searchKeywords: input.searchKeywords,
          displayOrder: input.displayOrder,
          status: input.status,
        });
        if (id === undefined) throw slugTaken();
        await repository.setDescription(trx, id, input.description);
        const after = await load(trx, id);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'product.create',
          entityType: ENTITY,
          entityId: id,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async update(actor, id, input) {
      return mutate(actor, id, 'product.update', async (trx) => {
        await assertReferences(trx, input);
        const updated = await repository.update(trx, id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.clothingTypeId !== undefined && { clothingTypeId: input.clothingTypeId }),
          ...(input.measurementProfileId !== undefined && {
            measurementProfileId: input.measurementProfileId,
          }),
          ...(input.priceMinor !== undefined && { priceMinor: input.priceMinor }),
          ...(input.searchKeywords !== undefined && { searchKeywords: input.searchKeywords }),
          ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
        });
        if (!updated) throw slugTaken();
        if (input.description !== undefined) {
          await repository.setDescription(trx, id, input.description);
        }
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
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'product.status_change',
          entityType: ENTITY,
          entityId: id,
          before,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async setVideo(actor, id, mediaAssetId) {
      return mutate(actor, id, 'product.video_replace', async (trx) => {
        await deps.media.assertReadyVideo(trx, mediaAssetId);
        await repository.setVideo(trx, id, mediaAssetId);
      });
    },

    async setImages(actor, id, mediaAssetIds) {
      return mutate(actor, id, 'product.images_replace', async (trx) => {
        await deps.media.assertReadyImages(trx, mediaAssetIds);
        await repository.setImages(trx, id, mediaAssetIds);
      });
    },
  };
}
