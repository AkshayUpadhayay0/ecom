import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface ClothingTypeRow {
  id: string;
  slug: string;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
  /** languageCode -> name */
  names: Record<string, string>;
}

export interface ClothingTypeFilters {
  q?: string | undefined;
  isActive?: boolean | undefined;
  sort: 'sortOrder' | 'slug' | 'createdAt';
  order: 'asc' | 'desc';
}

export interface ClothingTypeValues {
  slug: string;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
}

const COLUMNS = [
  'ct.id',
  'ct.slug',
  'ct.search_keywords as searchKeywords',
  'ct.sort_order as sortOrder',
  'ct.is_active as isActive',
] as const;

/** clothing_types has no timestamps; `createdAt` sorting falls back to slug. */
const SORT_COLUMNS = {
  sortOrder: 'ct.sort_order',
  slug: 'ct.slug',
  createdAt: 'ct.slug',
} as const;

export interface ClothingTypesRepository {
  list(
    db: Database,
    filters: ClothingTypeFilters,
    page: PageRequest,
  ): Promise<{ rows: ClothingTypeRow[]; total: number }>;
  /** `lock` takes a row lock (inside a transaction) so before/after audit snapshots are exact. */
  findById(db: Database, id: string, lock?: boolean): Promise<ClothingTypeRow | undefined>;
  exists(db: Database, id: string): Promise<boolean>;
  /** Returns undefined if the slug is taken. */
  insert(db: Database, values: ClothingTypeValues): Promise<string | undefined>;
  /** Returns false if the new slug is taken. */
  update(db: Database, id: string, values: Partial<ClothingTypeValues>): Promise<boolean>;
  upsertNames(db: Database, id: string, names: Record<string, string>): Promise<void>;
  deleteNames(db: Database, id: string, languageCodes: string[]): Promise<void>;
}

async function namesFor(db: Database, ids: string[]): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>(ids.map((id) => [id, {}]));
  if (ids.length === 0) return result;
  const rows = await db
    .selectFrom('clothing_type_translations')
    .select(['clothing_type_id as id', 'language_code as languageCode', 'name'])
    .where('clothing_type_id', 'in', ids)
    .execute();
  for (const row of rows) {
    const names = result.get(row.id);
    if (names) names[row.languageCode] = row.name;
  }
  return result;
}

export function createClothingTypesRepository(): ClothingTypesRepository {
  return {
    async list(db, filters, page) {
      let query = db.selectFrom('clothing_types as ct');
      if (filters.isActive !== undefined)
        query = query.where('ct.is_active', '=', filters.isActive);
      if (filters.q !== undefined) {
        const pattern = `%${escapeLike(filters.q)}%`;
        query = query.where((eb) =>
          eb.or([
            eb('ct.slug', 'ilike', pattern),
            eb('ct.search_keywords', 'ilike', pattern),
            eb.exists(
              eb
                .selectFrom('clothing_type_translations as t')
                .select('t.clothing_type_id')
                .whereRef('t.clothing_type_id', '=', 'ct.id')
                .where('t.name', 'ilike', pattern),
            ),
          ]),
        );
      }
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy(SORT_COLUMNS[filters.sort], filters.order)
          .orderBy('ct.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      const names = await namesFor(
        db,
        rows.map((row) => row.id),
      );
      return {
        rows: rows.map((row) => ({ ...row, names: names.get(row.id) ?? {} })),
        total: Number(count.total),
      };
    },

    async findById(db, id, lock = false) {
      let query = db.selectFrom('clothing_types as ct').select(COLUMNS).where('ct.id', '=', id);
      if (lock) query = query.forUpdate();
      const row = await query.executeTakeFirst();
      if (!row) return undefined;
      const names = await namesFor(db, [id]);
      return { ...row, names: names.get(id) ?? {} };
    },

    async exists(db, id) {
      const row = await db
        .selectFrom('clothing_types')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      return row !== undefined;
    },

    async insert(db, values) {
      try {
        const row = await db
          .insertInto('clothing_types')
          .values({
            slug: values.slug,
            search_keywords: values.searchKeywords,
            sort_order: values.sortOrder,
            is_active: values.isActive,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return undefined;
        throw err;
      }
    },

    async update(db, id, values) {
      try {
        await db
          .updateTable('clothing_types')
          .set({
            ...(values.slug !== undefined && { slug: values.slug }),
            ...(values.searchKeywords !== undefined && { search_keywords: values.searchKeywords }),
            ...(values.sortOrder !== undefined && { sort_order: values.sortOrder }),
            ...(values.isActive !== undefined && { is_active: values.isActive }),
          })
          .where('id', '=', id)
          .execute();
        return true;
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return false;
        throw err;
      }
    },

    async upsertNames(db, id, names) {
      const rows = Object.entries(names).map(([languageCode, name]) => ({
        clothing_type_id: id,
        language_code: languageCode,
        name,
      }));
      if (rows.length === 0) return;
      await db
        .insertInto('clothing_type_translations')
        .values(rows)
        .onConflict((oc) =>
          oc
            .columns(['clothing_type_id', 'language_code'])
            .doUpdateSet((eb) => ({ name: eb.ref('excluded.name') })),
        )
        .execute();
    },

    async deleteNames(db, id, languageCodes) {
      if (languageCodes.length === 0) return;
      await db
        .deleteFrom('clothing_type_translations')
        .where('clothing_type_id', '=', id)
        .where('language_code', 'in', languageCodes)
        .execute();
    },
  };
}
