import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface GarmentCutRow {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGarmentCut {
  code: string;
  name: string;
  notes: string | null;
  isActive: boolean;
}

export interface GarmentCutPatch {
  name?: string;
  notes?: string | null;
  isActive?: boolean;
}

const COLUMNS = [
  'id',
  'code',
  'name',
  'notes',
  'is_active as isActive',
  'created_at as createdAt',
  'updated_at as updatedAt',
] as const;

export interface GarmentCutsRepository {
  list(
    db: Database,
    filters: { q?: string | undefined; isActive?: boolean | undefined; order: 'asc' | 'desc' },
    page: PageRequest,
  ): Promise<{ rows: GarmentCutRow[]; total: number }>;
  findById(db: Database, id: string, lock?: boolean): Promise<GarmentCutRow | undefined>;
  /** Returns undefined if the code is taken. */
  insert(db: Database, cut: NewGarmentCut): Promise<GarmentCutRow | undefined>;
  update(db: Database, id: string, patch: GarmentCutPatch): Promise<GarmentCutRow | undefined>;
}

export function createGarmentCutsRepository(): GarmentCutsRepository {
  return {
    async list(db, filters, page) {
      let query = db.selectFrom('garment_cuts');
      if (filters.isActive !== undefined) query = query.where('is_active', '=', filters.isActive);
      if (filters.q !== undefined) {
        const pattern = `%${escapeLike(filters.q)}%`;
        query = query.where((eb) =>
          eb.or([eb('code', 'ilike', pattern), eb('name', 'ilike', pattern)]),
        );
      }
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy('name', filters.order)
          .orderBy('id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = db.selectFrom('garment_cuts').select(COLUMNS).where('id', '=', id);
      if (lock) query = query.forUpdate();
      return query.executeTakeFirst();
    },

    async insert(db, cut) {
      try {
        return await db
          .insertInto('garment_cuts')
          .values({ code: cut.code, name: cut.name, notes: cut.notes, is_active: cut.isActive })
          .returning(COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return undefined;
        throw err;
      }
    },

    async update(db, id, patch) {
      return db
        .updateTable('garment_cuts')
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.notes !== undefined && { notes: patch.notes }),
          ...(patch.isActive !== undefined && { is_active: patch.isActive }),
        })
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirst();
    },
  };
}
