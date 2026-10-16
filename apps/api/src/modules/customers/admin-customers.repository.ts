import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Database } from '../../db/database.js';
import type { Customers, DB } from '../../db/types.js';
import { escapeLike } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

const PAID = 'paid';
/** Latest orders shown on the customer detail page. */
const DETAIL_ORDER_LIMIT = 50;

export interface AdminCustomerRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  orderCount: number;
  paidTotalMinor: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  preferredLanguage: string;
  lockedUntil: Date | null;
}

export interface AdminCustomerAddressRow {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  landmark: string | null;
  zoneName: string;
  isDefault: boolean;
}

export interface AdminCustomerOrderRow {
  id: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  totalMinor: string;
  placedAt: Date;
}

/** Same expression as ix_customers_search_trgm (migration 0009). */
const CUSTOMER_SEARCH = sql<string>`(c.full_name || ' ' || c.email::text || ' ' || coalesce(c.phone, ''))`;

/**
 * Read-only customer lookup for admins plus the account status switch. Never selects password
 * hashes, tokens or sessions.
 */
export interface AdminCustomersRepository {
  list(
    db: Database,
    filters: { q?: string | undefined; status?: string | undefined },
    page: PageRequest,
  ): Promise<{ rows: AdminCustomerRow[]; total: number }>;
  find(db: Database, id: string, lock?: boolean): Promise<AdminCustomerRow | undefined>;
  addresses(db: Database, customerId: string): Promise<AdminCustomerAddressRow[]>;
  orders(db: Database, customerId: string): Promise<AdminCustomerOrderRow[]>;
  setStatus(db: Database, id: string, status: 'active' | 'suspended'): Promise<void>;
}

function baseQuery(db: Database) {
  return db
    .selectFrom('customers as c')
    .select([
      'c.id',
      'c.full_name as fullName',
      sql<string>`c.email::text`.as('email'),
      'c.phone',
      'c.status',
      'c.email_verified_at as emailVerifiedAt',
      'c.created_at as createdAt',
      'c.last_login_at as lastLoginAt',
      'c.preferred_language as preferredLanguage',
      'c.locked_until as lockedUntil',
    ])
    .select((eb) => [
      eb
        .selectFrom('orders as o')
        .select(sql<number>`count(*)::int`.as('n'))
        .whereRef('o.customer_id', '=', 'c.id')
        .as('orderCount'),
      eb
        .selectFrom('orders as o')
        .select(sql<string>`coalesce(sum(o.total_minor), 0)::text`.as('t'))
        .whereRef('o.customer_id', '=', 'c.id')
        .where('o.payment_status', '=', PAID)
        .as('paidTotalMinor'),
    ]);
}

export function createAdminCustomersRepository(): AdminCustomersRepository {
  return {
    async list(db, filters, page) {
      const where = (eb: ExpressionBuilder<DB & { c: Customers }, 'c'>) => {
        const conditions: Expression<SqlBool>[] = [];
        if (filters.status !== undefined) conditions.push(eb('c.status', '=', filters.status));
        if (filters.q !== undefined)
          conditions.push(eb(CUSTOMER_SEARCH, 'ilike', `%${escapeLike(filters.q)}%`));
        return eb.and(conditions);
      };
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .where(where)
          .orderBy('c.created_at', 'desc')
          .orderBy('c.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('customers as c')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .where(where)
          .executeTakeFirstOrThrow(),
      ]);
      return {
        rows: rows.map((row) => ({
          ...row,
          orderCount: row.orderCount ?? 0,
          paidTotalMinor: row.paidTotalMinor ?? '0',
        })),
        total: Number(count.total),
      };
    },

    async find(db, id, lock = false) {
      let query = baseQuery(db).where('c.id', '=', id);
      if (lock) query = query.forUpdate();
      const row = await query.executeTakeFirst();
      return row
        ? { ...row, orderCount: row.orderCount ?? 0, paidTotalMinor: row.paidTotalMinor ?? '0' }
        : undefined;
    },

    async addresses(db, customerId) {
      return db
        .selectFrom('customer_addresses as a')
        .innerJoin('delivery_zones as z', 'z.id', 'a.delivery_zone_id')
        .select([
          'a.id',
          'a.label',
          'a.recipient_name as recipientName',
          'a.phone',
          'a.address_line1 as addressLine1',
          'a.address_line2 as addressLine2',
          'a.city',
          'a.state',
          'a.landmark',
          'z.name as zoneName',
          'a.is_default as isDefault',
        ])
        .where('a.customer_id', '=', customerId)
        .orderBy('a.is_default', 'desc')
        .orderBy('a.created_at')
        .execute();
    },

    async orders(db, customerId) {
      return db
        .selectFrom('orders')
        .select([
          'id',
          'order_number as orderNumber',
          'order_status as orderStatus',
          'payment_status as paymentStatus',
          'currency',
          'total_minor as totalMinor',
          'placed_at as placedAt',
        ])
        .where('customer_id', '=', customerId)
        .orderBy('placed_at', 'desc')
        .limit(DETAIL_ORDER_LIMIT)
        .execute();
    },

    async setStatus(db, id, status) {
      await db.updateTable('customers').set({ status }).where('id', '=', id).execute();
    },
  };
}
