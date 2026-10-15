import type { AddressDto, CreateAddressRequest, UpdateAddressRequest } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { DeliveryZonesRepository } from '../delivery/delivery-zones.repository.js';
import type { AddressRow, AddressValues, AddressesRepository } from './addresses.repository.js';

export interface AddressesService {
  list(customerId: string): Promise<AddressDto[]>;
  get(customerId: string, id: string): Promise<AddressDto>;
  /** The first address becomes the default automatically. */
  create(customerId: string, input: CreateAddressRequest, db?: Database): Promise<AddressDto>;
  update(customerId: string, id: string, input: UpdateAddressRequest): Promise<AddressDto>;
  remove(customerId: string, id: string): Promise<void>;
}

export interface AddressesServiceDeps {
  db: Database;
  repository: AddressesRepository;
  zones: DeliveryZonesRepository;
}

export function toAddressDto(row: AddressRow): AddressDto {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    landmark: row.landmark,
    deliveryZone: { id: row.deliveryZoneId, code: row.zoneCode, name: row.zoneName },
    isDefault: row.isDefault,
  };
}

/** The values a request sets (null clears optional fields). */
function valuesOf(input: CreateAddressRequest): AddressValues {
  return {
    label: input.label ?? null,
    recipientName: input.recipientName,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state ?? null,
    landmark: input.landmark ?? null,
    deliveryZoneId: input.deliveryZoneId,
  };
}

export function createAddressesService({
  db,
  repository,
  zones,
}: AddressesServiceDeps): AddressesService {
  async function assertSelectableZone(executor: Database, zoneId: string): Promise<void> {
    const zone = await zones.findById(executor, zoneId);
    // Only zones customers can order to: active (which implies a fee, by DB rule).
    if (!zone?.isActive) {
      throw new AppError(
        'INVALID_DELIVERY_ZONE',
        HTTP_STATUS.BAD_REQUEST,
        'Choose an available delivery area.',
        {
          issues: [{ path: 'deliveryZoneId', message: 'Unknown or unavailable delivery area.' }],
        },
      );
    }
  }

  async function load(executor: Database, customerId: string, id: string): Promise<AddressDto> {
    const row = await repository.findOwned(executor, id, customerId);
    if (!row) throw notFoundError('Address');
    return toAddressDto(row);
  }

  return {
    async list(customerId) {
      return (await repository.list(db, customerId)).map(toAddressDto);
    },

    get: (customerId, id) => load(db, customerId, id),

    async create(customerId, input, executor) {
      const run = async (trx: Database) => {
        await assertSelectableZone(trx, input.deliveryZoneId);
        const first = (await repository.count(trx, customerId)) === 0;
        const makeDefault = first || input.isDefault;
        if (makeDefault) await repository.clearDefault(trx, customerId);
        const id = await repository.insert(trx, customerId, valuesOf(input), makeDefault);
        return load(trx, customerId, id);
      };
      // Checkout passes its own transaction; standalone calls get one.
      return executor ? run(executor) : db.transaction().execute(run);
    },

    async update(customerId, id, input) {
      return db.transaction().execute(async (trx) => {
        await load(trx, customerId, id);
        if (input.deliveryZoneId !== undefined)
          await assertSelectableZone(trx, input.deliveryZoneId);
        const { isDefault, ...values } = input;
        await repository.update(trx, id, customerId, values);
        if (isDefault) {
          await repository.clearDefault(trx, customerId);
          await repository.setDefault(trx, id, customerId);
        }
        return load(trx, customerId, id);
      });
    },

    async remove(customerId, id) {
      await db.transaction().execute(async (trx) => {
        const current = await repository.findOwned(trx, id, customerId);
        if (!current) throw notFoundError('Address');
        // Orders keep their own address snapshot, so deleting never changes history.
        await repository.delete(trx, id, customerId);
        if (current.isDefault) {
          const next = await repository.oldestId(trx, customerId);
          if (next) await repository.setDefault(trx, next, customerId);
        }
      });
    },
  };
}
