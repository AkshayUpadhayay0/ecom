import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface SizeRow {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const COLUMNS = [
  'id',
  'code',
  'label',
  'sort_order as sortOrder',
  'is_active as isActive',
] as const;

/** Sizes are seeded together with the size charts; the admin API only reads and reorders them. */
export interface SizesRepository {
  list(
    db: Database,
    filters: { isActive?: boolean | undefined; order: 'asc' | 'desc' },
    page: PageRequest,
  ): Promise<{ rows: SizeRow[]; total: number }>;
  /** Every size in display order. */
  listAll(db: Database): Promise<SizeRow[]>;
  findById(db: Database, id: string): Promise<SizeRow | undefined>;
  /** Every size id, locked inside a transaction (reorder validation). */
  lockAllIds(db: Database): Promise<string[]>;
  /** Sets sort_order = position (1-based) for every id in one statement. */
  setOrder(db: Database, ids: string[]): Promise<void>;
}

export function createSizesRepository(): SizesRepository {
  return {
    async list(db, filters, page) {
      let query = db.selectFrom('sizes');
      if (filters.isActive !== undefined) query = query.where('is_active', '=', filters.isActive);
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy('sort_order', filters.order)
          .orderBy('code')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async listAll(db) {
      return db.selectFrom('sizes').select(COLUMNS).orderBy('sort_order').orderBy('code').execute();
    },

    async findById(db, id) {
      return db.selectFrom('sizes').select(COLUMNS).where('id', '=', id).executeTakeFirst();
    },

    async lockAllIds(db) {
      const rows = await db.selectFrom('sizes').select('id').forUpdate().execute();
      return rows.map((row) => row.id);
    },

    async setOrder(db, ids) {
      await sql`
        UPDATE sizes AS s SET sort_order = o.position
        FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS o(id, position)
        WHERE s.id = o.id`.execute(db);
    },
  };
}
