import type {
  CreateVariantRequest,
  ListVariantsQuery,
  LowStockVariantDto,
  PaginationQuery,
  StockAdjustmentRequest,
  StockAdjustmentResultDto,
  StockMovementDto,
  UpdateVariantRequest,
  VariantDto,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, alreadyExistsError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { ProductsRepository } from '../catalog/products.repository.js';
import type { SizesRepository } from '../catalog/sizes.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toLowStockVariantDto, toStockMovementDto, toVariantDto } from './inventory.dto.js';
import type { StockChange, VariantsRepository } from './variants.repository.js';

const ENTITY = 'product_variant';
const ARCHIVED = 'archived';
/** stock_movements.reference_type for changes made from the admin panel. */
const ADMIN_REFERENCE = 'admin';

export interface InventoryService {
  listVariants(productId: string, query: ListVariantsQuery): Promise<Page<VariantDto>>;
  createVariant(
    actor: AuditActor,
    productId: string,
    input: CreateVariantRequest,
  ): Promise<VariantDto>;
  /** SKU, low-stock threshold, active flag. Stock only changes through adjustStock. */
  updateVariant(actor: AuditActor, id: string, input: UpdateVariantRequest): Promise<VariantDto>;
  /**
   * One transaction: conditional stock UPDATE (refuses to go below reserved units) + ledger row
   * in stock_movements + audit log.
   */
  adjustStock(
    actor: AuditActor,
    variantId: string,
    input: StockAdjustmentRequest,
  ): Promise<StockAdjustmentResultDto>;
  listMovements(variantId: string, query: PaginationQuery): Promise<Page<StockMovementDto>>;
  listLowStock(query: PaginationQuery): Promise<Page<LowStockVariantDto>>;
}

export interface InventoryServiceDeps {
  db: Database;
  repository: VariantsRepository;
  products: ProductsRepository;
  sizes: SizesRepository;
  settings: SettingsService;
}

function toStockChange(input: StockAdjustmentRequest): StockChange {
  switch (input.type) {
    case 'restock':
      return { kind: 'delta', delta: input.quantity };
    case 'initial':
      return { kind: 'set', onHand: input.newOnHand };
    case 'adjustment':
      return input.newOnHand !== undefined
        ? { kind: 'set', onHand: input.newOnHand }
        : { kind: 'delta', delta: input.quantity ?? 0 };
  }
}

function invalidField(path: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, message, {
    issues: [{ path, message }],
  });
}

export function createInventoryService(deps: InventoryServiceDeps): InventoryService {
  const { db, repository, settings } = deps;

  async function pageRequest(query: PaginationQuery) {
    return toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
  }

  async function assertVariantExists(executor: Database, id: string) {
    const row = await repository.findById(executor, id);
    if (!row) throw notFoundError('Variant');
    return row;
  }

  return {
    async listVariants(productId, query) {
      if (!(await deps.products.findById(db, productId))) throw notFoundError('Product');
      const page = await pageRequest(query);
      const { rows, total } = await repository.listForProduct(
        db,
        productId,
        { isActive: query.isActive, order: query.order ?? 'asc' },
        page,
      );
      return { items: rows.map(toVariantDto), meta: toPageMeta(page, total) };
    },

    async createVariant(actor, productId, input) {
      return db.transaction().execute(async (trx) => {
        const product = await deps.products.findById(trx, productId, true);
        if (!product) throw notFoundError('Product');
        if (product.status === ARCHIVED) {
          throw new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'Archived products cannot get new variants.',
          );
        }
        const size = await deps.sizes.findById(trx, input.sizeId);
        if (!size?.isActive) throw invalidField('sizeId', 'Unknown or inactive size.');

        const result = await repository.insert(trx, { productId, ...input });
        if (!result.ok) {
          throw result.conflict === 'sku'
            ? alreadyExistsError('sku', 'Another variant already uses this SKU.')
            : alreadyExistsError('sizeId', 'This product already has a variant in this size.');
        }
        const after = toVariantDto(result.row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'variant.create',
          entityType: ENTITY,
          entityId: after.id,
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async updateVariant(actor, id, input) {
      return db.transaction().execute(async (trx) => {
        const before = await repository.findById(trx, id, true);
        if (!before) throw notFoundError('Variant');
        const row = await repository.update(trx, id, {
          ...(input.sku !== undefined && { sku: input.sku }),
          ...(input.lowStockThreshold !== undefined && {
            lowStockThreshold: input.lowStockThreshold,
          }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        });
        if (row === 'sku_taken') {
          throw alreadyExistsError('sku', 'Another variant already uses this SKU.');
        }
        if (!row) throw notFoundError('Variant');
        const after = toVariantDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'variant.update',
          entityType: ENTITY,
          entityId: id,
          before: toVariantDto(before),
          after,
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },

    async adjustStock(actor, variantId, input) {
      return db.transaction().execute(async (trx) => {
        const change = await repository.changeStock(trx, variantId, toStockChange(input));
        if (!change) {
          const variant = await assertVariantExists(trx, variantId);
          throw new AppError(
            'STOCK_BELOW_RESERVED',
            HTTP_STATUS.CONFLICT,
            'Stock on hand cannot be set below the units reserved by open checkouts.',
            { stockOnHand: variant.stockOnHand, stockReserved: variant.stockReserved },
          );
        }
        // The UPDATE above holds the row lock, so this check cannot race another 'initial'.
        if (input.type === 'initial' && (await repository.hasMovements(trx, variantId))) {
          throw new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'Initial stock can only be set before any stock movement. Use an adjustment.',
          );
        }
        const movement = await repository.insertMovement(trx, {
          variantId,
          type: input.type,
          quantityDelta: change.stockOnHand - change.previousOnHand,
          referenceType: ADMIN_REFERENCE,
          referenceId: null,
          note: input.note ?? null,
          adminId: actor.adminId,
        });
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'variant.stock_adjust',
          entityType: ENTITY,
          entityId: variantId,
          before: { stockOnHand: change.previousOnHand, stockReserved: change.stockReserved },
          after: {
            stockOnHand: change.stockOnHand,
            stockReserved: change.stockReserved,
            type: input.type,
            quantityDelta: movement.quantityDelta,
            movementId: movement.id,
          },
          ipAddress: actor.ipAddress,
        });
        const variant = await assertVariantExists(trx, variantId);
        return { variant: toVariantDto(variant), movement: toStockMovementDto(movement) };
      });
    },

    async listMovements(variantId, query) {
      await assertVariantExists(db, variantId);
      const page = await pageRequest(query);
      const { rows, total } = await repository.listMovements(
        db,
        variantId,
        query.order ?? 'desc',
        page,
      );
      return { items: rows.map(toStockMovementDto), meta: toPageMeta(page, total) };
    },

    async listLowStock(query) {
      const page = await pageRequest(query);
      const { rows, total } = await repository.listLowStock(db, query.order ?? 'asc', page);
      return { items: rows.map(toLowStockVariantDto), meta: toPageMeta(page, total) };
    },
  };
}
