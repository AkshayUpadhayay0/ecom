import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import { PG_ERROR, escapeLike, isPgErrorCode } from '../../lib/db-errors.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface ClothingTypeRow {
  id: string;
  slug: string;
  /** Default-language name (canonical; no translation management). */
  name: string | null;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ClothingTypeFilters {
  q?: string | undefined;
  isActive?: boolean | undefined;
  sort: 'sortOrder' | 'slug';
  order: 'asc' | 'desc';
}

export interface ClothingTypeValues {
  slug: string;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
}

const SORT_COLUMNS = { sortOrder: 'ct.sort_order', slug: 'ct.slug' } as const;

/** The default language, read from data (never hard-coded). */
const DEFAULT_LANGUAGE = sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`;

function baseQuery(db: Database) {
  return db
    .selectFrom('clothing_types as ct')
    .leftJoin('clothing_type_translations as t', (join) =>
      join.onRef('t.clothing_type_id', '=', 'ct.id').on('t.language_code', '=', DEFAULT_LANGUAGE),
    );
}

const COLUMNS = [
  'ct.id',
  'ct.slug',
  't.name',
  'ct.search_keywords as searchKeywords',
  'ct.sort_order as sortOrder',
  'ct.is_active as isActive',
] as const;

export interface ClothingTypesRepository {
  list(
    db: Database,
    filters: ClothingTypeFilters,
    page: PageRequest,
  ): Promise<{ rows: ClothingTypeRow[]; total: number }>;
  /** `lock` takes a row lock (inside a transaction) so before/after audit snapshots are exact. */
  findById(db: Database, id: string, lock?: boolean): Promise<ClothingTypeRow | undefined>;
  /** Returns undefined if the slug is taken. */
  insert(db: Database, values: ClothingTypeValues): Promise<string | undefined>;
  /** Returns false if the new slug is taken. */
  update(db: Database, id: string, values: Partial<ClothingTypeValues>): Promise<boolean>;
  /** Stores the canonical name as the default-language row. */
  setName(db: Database, id: string, name: string): Promise<void>;
}

export function createClothingTypesRepository(): ClothingTypesRepository {
  return {
    async list(db, filters, page) {
      let query = baseQuery(db);
      if (filters.isActive !== undefined)
        query = query.where('ct.is_active', '=', filters.isActive);
      if (filters.q !== undefined) {
        const pattern = `%${escapeLike(filters.q)}%`;
        query = query.where((eb) =>
          eb.or([
            eb('ct.slug', 'ilike', pattern),
            eb('ct.search_keywords', 'ilike', pattern),
            eb('t.name', 'ilike', pattern),
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
      return { rows, total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = baseQuery(db).select(COLUMNS).where('ct.id', '=', id);
      if (lock) query = query.forUpdate('ct');
      return query.executeTakeFirst();
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
      const changes = {
        ...(values.slug !== undefined && { slug: values.slug }),
        ...(values.searchKeywords !== undefined && { search_keywords: values.searchKeywords }),
        ...(values.sortOrder !== undefined && { sort_order: values.sortOrder }),
        ...(values.isActive !== undefined && { is_active: values.isActive }),
      };
      if (Object.keys(changes).length === 0) return true;
      try {
        await db.updateTable('clothing_types').set(changes).where('id', '=', id).execute();
        return true;
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) return false;
        throw err;
      }
    },

    async setName(db, id, name) {
      await db
        .insertInto('clothing_type_translations')
        .values({ clothing_type_id: id, language_code: DEFAULT_LANGUAGE, name })
        .onConflict((oc) =>
          oc
            .columns(['clothing_type_id', 'language_code'])
            .doUpdateSet((eb) => ({ name: eb.ref('excluded.name') })),
        )
        .execute();
    },
  };
}
