import type {
  CreateDeliveryZoneRequest,
  DeliveryZoneDto,
  ListDeliveryZonesQuery,
  UpdateDeliveryZoneRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, alreadyExistsError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toDeliveryZoneDto } from './delivery-zones.dto.js';
import type { DeliveryZonesRepository, ZoneWriteFailure } from './delivery-zones.repository.js';

const ENTITY = 'delivery_zone';

export interface DeliveryZonesService {
  list(query: ListDeliveryZonesQuery): Promise<Page<DeliveryZoneDto>>;
  get(id: string): Promise<DeliveryZoneDto>;
  create(actor: AuditActor, input: CreateDeliveryZoneRequest): Promise<DeliveryZoneDto>;
  /** Deactivate with `{ isActive: false }`; zones are never deleted (addresses/orders use them). */
  update(actor: AuditActor, id: string, input: UpdateDeliveryZoneRequest): Promise<DeliveryZoneDto>;
}

export interface DeliveryZonesServiceDeps {
  db: Database;
  repository: DeliveryZonesRepository;
  settings: SettingsService;
}

function feeRequired(): AppError {
  return new AppError(
    'ZONE_FEE_REQUIRED',
    HTTP_STATUS.BAD_REQUEST,
    'Set a delivery fee before activating this zone.',
    { issues: [{ path: 'feeMinor', message: 'Required when the zone is active.' }] },
  );
}

function sampleZoneLocked(): AppError {
  return new AppError(
    'INVALID_STATE',
    HTTP_STATUS.CONFLICT,
    'Sample delivery zones stay inactive. Create a real zone instead.',
  );
}

function toError(failure: ZoneWriteFailure): AppError {
  return failure === 'code_taken'
    ? alreadyExistsError('code', 'A delivery zone with this code already exists.')
    : feeRequired();
}

export function createDeliveryZonesService({
  db,
  repository,
  settings,
}: DeliveryZonesServiceDeps): DeliveryZonesService {
  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(
        db,
        { q: query.q, isActive: query.isActive, order: query.order ?? 'asc' },
        page,
      );
      return { items: rows.map(toDeliveryZoneDto), meta: toPageMeta(page, total) };
    },

    async get(id) {
      const row = await repository.findById(db, id);
      if (!row) throw notFoundError('Delivery zone');
      return toDeliveryZoneDto(row);
    },

    async create(actor, input) {
      if (input.isActive && input.feeMinor === null) throw feeRequired();
      return db.transaction().execute(async (trx) => {
        const row = await repository.insert(trx, input);
        if (typeof row === 'string') throw toError(row);
        const after = toDeliveryZoneDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'delivery_zone.create',
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
        const current = await repository.findById(trx, id, true);
        if (!current) throw notFoundError('Delivery zone');
        const before = toDeliveryZoneDto(current);

        const willBeActive = input.isActive ?? before.isActive;
        const fee = input.feeMinor === undefined ? before.feeMinor : input.feeMinor;
        if (willBeActive && fee === null) throw feeRequired();
        if (willBeActive && !before.isActive && before.isSampleData) throw sampleZoneLocked();
        const estMin = input.estDaysMin === undefined ? before.estDaysMin : input.estDaysMin;
        const estMax = input.estDaysMax === undefined ? before.estDaysMax : input.estDaysMax;
        if (estMin !== null && estMax !== null && estMin > estMax) {
          throw new AppError(
            'VALIDATION_ERROR',
            HTTP_STATUS.BAD_REQUEST,
            'Request validation failed.',
            {
              issues: [{ path: 'estDaysMax', message: 'estDaysMin must not exceed estDaysMax' }],
            },
          );
        }

        const row = await repository.update(trx, id, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.feeMinor !== undefined && { feeMinor: input.feeMinor }),
          ...(input.estDaysMin !== undefined && { estDaysMin: input.estDaysMin }),
          ...(input.estDaysMax !== undefined && { estDaysMax: input.estDaysMax }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        });
        if (typeof row === 'string') throw toError(row);
        if (!row) throw notFoundError('Delivery zone');
        const after = toDeliveryZoneDto(row);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'delivery_zone.update',
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
