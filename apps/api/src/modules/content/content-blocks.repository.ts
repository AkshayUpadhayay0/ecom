import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface ContentBlockRow {
  id: string;
  key: string;
  /** content_kind: 'video' (hero) or 'text' (footer, policies). */
  kind: 'text' | 'video';
  isPublished: boolean;
  mediaAssetId: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface ContentTranslationRow {
  languageCode: string;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
}

const COLUMNS = [
  'id',
  'block_key as key',
  'content_kind as kind',
  'is_published as isPublished',
  'media_asset_id as mediaAssetId',
  'updated_at as updatedAt',
  'updated_by as updatedBy',
] as const;

export interface ContentBlocksRepository {
  list(
    db: Database,
    order: 'asc' | 'desc',
    page: PageRequest,
  ): Promise<{ rows: ContentBlockRow[]; total: number }>;
  findByKey(db: Database, key: string, lock?: boolean): Promise<ContentBlockRow | undefined>;
  translationsFor(db: Database, blockIds: string[]): Promise<Map<string, ContentTranslationRow[]>>;
  /** Writes the title / body of one language (text blocks; English only from the admin). */
  upsertText(
    db: Database,
    blockId: string,
    languageCode: string,
    text: { title: string; body: string },
  ): Promise<void>;
  /** Sets the given columns plus updated_by / updated_at. */
  touch(
    db: Database,
    blockId: string,
    adminId: string,
    changes: { isPublished?: boolean; mediaAssetId?: string | null },
  ): Promise<void>;
}

export function createContentBlocksRepository(): ContentBlocksRepository {
  return {
    async list(db, order, page) {
      const query = db.selectFrom('content_blocks');
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy('block_key', order)
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return {
        rows: rows.map((row) => ({ ...row, kind: row.kind as ContentBlockRow['kind'] })),
        total: Number(count.total),
      };
    },

    async findByKey(db, key, lock = false) {
      let query = db.selectFrom('content_blocks').select(COLUMNS).where('block_key', '=', key);
      if (lock) query = query.forUpdate();
      const row = await query.executeTakeFirst();
      // content_kind is CHECK-constrained to these values.
      return row && { ...row, kind: row.kind as ContentBlockRow['kind'] };
    },

    async upsertText(db, blockId, languageCode, text) {
      await db
        .insertInto('content_block_translations')
        .values({
          content_block_id: blockId,
          language_code: languageCode,
          title: text.title,
          body: text.body,
        })
        .onConflict((oc) =>
          oc
            .columns(['content_block_id', 'language_code'])
            .doUpdateSet({ title: text.title, body: text.body }),
        )
        .execute();
    },

    async translationsFor(db, blockIds) {
      const result = new Map<string, ContentTranslationRow[]>(blockIds.map((id) => [id, []]));
      if (blockIds.length === 0) return result;
      const rows = await db
        .selectFrom('content_block_translations')
        .select([
          'content_block_id as blockId',
          'language_code as languageCode',
          'title',
          'body',
          'cta_label as ctaLabel',
        ])
        .where('content_block_id', 'in', blockIds)
        .orderBy('language_code')
        .execute();
      for (const { blockId, ...translation } of rows) result.get(blockId)?.push(translation);
      return result;
    },

    async touch(db, blockId, adminId, changes) {
      await db
        .updateTable('content_blocks')
        .set((eb) => ({
          ...(changes.isPublished !== undefined && { is_published: changes.isPublished }),
          ...(changes.mediaAssetId !== undefined && { media_asset_id: changes.mediaAssetId }),
          updated_by: adminId,
          updated_at: eb.fn('now'),
        }))
        .where('id', '=', blockId)
        .execute();
    },
  };
}
