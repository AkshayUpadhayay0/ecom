import { sql } from 'kysely';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

/** The default language, read from data (never hard-coded). */
const DEFAULT_LANGUAGE = sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`;

export interface HiddenPageRow {
  id: string;
  slotNumber: number;
  slug: string;
  routeToken: string;
  exclusiveOnly: boolean;
  isPublished: boolean;
  tokenLockedAt: Date | null;
  title: string | null;
  body: string | null;
  updatedAt: Date;
}

export interface PageSlotRow {
  id: string;
  slotNumber: number;
  exclusiveOnly: boolean;
}

function baseQuery(db: Database) {
  return db
    .selectFrom('qr_pages as p')
    .leftJoin('qr_page_translations as t', (join) =>
      join.onRef('t.qr_page_id', '=', 'p.id').on('t.language_code', '=', DEFAULT_LANGUAGE),
    );
}

const COLUMNS = [
  'p.id',
  'p.slot_number as slotNumber',
  'p.slug',
  'p.route_token as routeToken',
  'p.exclusive_only as exclusiveOnly',
  'p.is_published as isPublished',
  'p.token_locked_at as tokenLockedAt',
  't.title',
  't.body',
  'p.updated_at as updatedAt',
] as const;

/**
 * Hidden pages (8 today; the number is data). Slugs and locked route tokens are immutable (DB
 * trigger); nothing here writes them.
 */
export interface HiddenPagesRepository {
  list(db: Database, page: PageRequest): Promise<{ rows: HiddenPageRow[]; total: number }>;
  findById(db: Database, id: string, lock?: boolean): Promise<HiddenPageRow | undefined>;
  /** Published pages only: unpublished pages behave as unknown. */
  findPublishedByRouteToken(db: Database, routeToken: string): Promise<HiddenPageRow | undefined>;
  listSlots(db: Database): Promise<PageSlotRow[]>;
  /** Writes the default-language title/body and bumps updated_at. */
  updateContent(db: Database, id: string, content: { title: string; body: string }): Promise<void>;
}

export function createHiddenPagesRepository(): HiddenPagesRepository {
  return {
    async list(db, page) {
      const [rows, count] = await Promise.all([
        baseQuery(db)
          .select(COLUMNS)
          .orderBy('p.slot_number')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('qr_pages')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .executeTakeFirstOrThrow(),
      ]);
      return { rows, total: Number(count.total) };
    },

    async findById(db, id, lock = false) {
      let query = baseQuery(db).select(COLUMNS).where('p.id', '=', id);
      if (lock) query = query.forUpdate('p');
      return query.executeTakeFirst();
    },

    async findPublishedByRouteToken(db, routeToken) {
      return baseQuery(db)
        .select(COLUMNS)
        .where('p.route_token', '=', routeToken)
        .where('p.is_published', '=', true)
        .executeTakeFirst();
    },

    async listSlots(db) {
      return db
        .selectFrom('qr_pages')
        .select(['id', 'slot_number as slotNumber', 'exclusive_only as exclusiveOnly'])
        .execute();
    },

    async updateContent(db, id, content) {
      await db
        .insertInto('qr_page_translations')
        .values({
          qr_page_id: id,
          language_code: DEFAULT_LANGUAGE,
          title: content.title,
          body: content.body,
        })
        .onConflict((oc) =>
          oc.columns(['qr_page_id', 'language_code']).doUpdateSet((eb) => ({
            title: eb.ref('excluded.title'),
            body: eb.ref('excluded.body'),
          })),
        )
        .execute();
      await db
        .updateTable('qr_pages')
        .set({ updated_at: sql`now()` })
        .where('id', '=', id)
        .execute();
    },
  };
}
