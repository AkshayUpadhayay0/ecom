import type { Database } from '../../db/database.js';

export interface AddressRow {
  id: string;
  customerId: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZoneId: string;
  zoneCode: string;
  zoneName: string;
  isDefault: boolean;
}

export interface AddressValues {
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  deliveryZoneId: string;
}

function addressQuery(db: Database) {
  return db
    .selectFrom('customer_addresses as a')
    .innerJoin('delivery_zones as z', 'z.id', 'a.delivery_zone_id')
    .select([
      'a.id',
      'a.customer_id as customerId',
      'a.label',
      'a.recipient_name as recipientName',
      'a.phone',
      'a.address_line1 as addressLine1',
      'a.address_line2 as addressLine2',
      'a.city',
      'a.state',
      'a.landmark',
      'a.delivery_zone_id as deliveryZoneId',
      'z.code as zoneCode',
      'z.name as zoneName',
      'a.is_default as isDefault',
    ]);
}

/** A partial update: undefined = unchanged, null clears an optional field. */
export type AddressPatch = { [K in keyof AddressValues]?: AddressValues[K] | undefined };

const toColumns = (values: AddressPatch) => ({
  ...(values.label !== undefined && { label: values.label }),
  ...(values.recipientName !== undefined && { recipient_name: values.recipientName }),
  ...(values.phone !== undefined && { phone: values.phone }),
  ...(values.addressLine1 !== undefined && { address_line1: values.addressLine1 }),
  ...(values.addressLine2 !== undefined && { address_line2: values.addressLine2 }),
  ...(values.city !== undefined && { city: values.city }),
  ...(values.state !== undefined && { state: values.state }),
  ...(values.landmark !== undefined && { landmark: values.landmark }),
  ...(values.deliveryZoneId !== undefined && { delivery_zone_id: values.deliveryZoneId }),
});

/** Saved delivery details. Every query is scoped to the owning customer. */
export interface AddressesRepository {
  list(db: Database, customerId: string): Promise<AddressRow[]>;
  findOwned(db: Database, id: string, customerId: string): Promise<AddressRow | undefined>;
  count(db: Database, customerId: string): Promise<number>;
  insert(
    db: Database,
    customerId: string,
    values: AddressValues,
    isDefault: boolean,
  ): Promise<string>;
  update(db: Database, id: string, customerId: string, values: AddressPatch): Promise<void>;
  /** Clears the default flag on every address of the customer (before setting a new one). */
  clearDefault(db: Database, customerId: string): Promise<void>;
  setDefault(db: Database, id: string, customerId: string): Promise<void>;
  delete(db: Database, id: string, customerId: string): Promise<boolean>;
  /** Oldest remaining address (becomes the default when the default is deleted). */
  oldestId(db: Database, customerId: string): Promise<string | undefined>;
}

export function createAddressesRepository(): AddressesRepository {
  return {
    async list(db, customerId) {
      return addressQuery(db)
        .where('a.customer_id', '=', customerId)
        .orderBy('a.is_default', 'desc')
        .orderBy('a.created_at')
        .execute();
    },

    async findOwned(db, id, customerId) {
      return addressQuery(db)
        .where('a.id', '=', id)
        .where('a.customer_id', '=', customerId)
        .executeTakeFirst();
    },

    async count(db, customerId) {
      const row = await db
        .selectFrom('customer_addresses')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('customer_id', '=', customerId)
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },

    async insert(db, customerId, values, isDefault) {
      const row = await db
        .insertInto('customer_addresses')
        .values({
          customer_id: customerId,
          label: values.label,
          recipient_name: values.recipientName,
          phone: values.phone,
          address_line1: values.addressLine1,
          address_line2: values.addressLine2,
          city: values.city,
          state: values.state,
          landmark: values.landmark,
          delivery_zone_id: values.deliveryZoneId,
          is_default: isDefault,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async update(db, id, customerId, values) {
      const changes = toColumns(values);
      if (Object.keys(changes).length === 0) return;
      await db
        .updateTable('customer_addresses')
        .set(changes)
        .where('id', '=', id)
        .where('customer_id', '=', customerId)
        .execute();
    },

    async clearDefault(db, customerId) {
      await db
        .updateTable('customer_addresses')
        .set({ is_default: false })
        .where('customer_id', '=', customerId)
        .where('is_default', '=', true)
        .execute();
    },

    async setDefault(db, id, customerId) {
      await db
        .updateTable('customer_addresses')
        .set({ is_default: true })
        .where('id', '=', id)
        .where('customer_id', '=', customerId)
        .execute();
    },

    async delete(db, id, customerId) {
      const result = await db
        .deleteFrom('customer_addresses')
        .where('id', '=', id)
        .where('customer_id', '=', customerId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async oldestId(db, customerId) {
      const row = await db
        .selectFrom('customer_addresses')
        .select('id')
        .where('customer_id', '=', customerId)
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst();
      return row?.id;
    },
  };
}
