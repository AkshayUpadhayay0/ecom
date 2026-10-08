import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { PG_ERROR, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface SizeRow {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface NewSize {
  code: string;
  label: string;
  /** Omitted: placed after the current last size. */
  sortOrder?: number | undefined;
  isActive: boolean;
}

export interface SizePatch {
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const COLUMNS = [
  'id',
  'code',
  'label',
  'sort_order as sortOrder',
  'is_active as isActive',
] as const;

export interface SizesRepository {
  list(
    db: Database,
    filters: { isActive?: boolean | undefined; order: 'asc' | 'desc' },
    page: PageRequest,
  ): Promise<{ rows: SizeRow[]; total: number }>;
  findById(db: Database, id: string, lock?: boolean): Promise<SizeRow | undefined>;
  /** Every size id (for reorder validation), locked inside a transaction. */
  lockAllIds(db: Database): Promise<string[]>;
  /** Returns undefined if the code is taken. */
  insert(db: Database, size: NewSize): Promise<SizeRow | undefined>;
  update(db: Database, id: string, patch: SizePatch): Promise<SizeRow | undefined>;
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

    async findById(db, id, lock = false) {
      let query = db.selectFrom('sizes').select(COLUMNS).where('id', '=', id);
      if (lock) query = query.forUpdate();
      return query.executeTakeFirst();
    },

    async lockAllIds(db) {
      const rows = await db.selectFrom('sizes').select('id').forUpdate().execute();
      return rows.map((row) => row.id);
    },

    async insert(db, size) {
      try {
        return await db
          .insertInto('sizes')
          .values({
            code: size.code,
            label: size.label,
            is_active: size.isActive,
            sort_order:
              size.sortOrder ?? sql<number>`(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sizes)`,
          })
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return undefined;
        throw err;
      }
    },

    async update(db, id, patch) {
      return db
        .updateTable('sizes')
        .set({
          ...(patch.label !== undefined && { label: patch.label }),
          ...(patch.sortOrder !== undefined && { sort_order: patch.sortOrder }),
          ...(patch.isActive !== undefined && { is_active: patch.isActive }),
        })
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirst();
    },

    async setOrder(db, ids) {
      await sql`
        UPDATE sizes AS s SET sort_order = o.position
        FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS o(id, position)
        WHERE s.id = o.id`.execute(db);
    },
  };
}
