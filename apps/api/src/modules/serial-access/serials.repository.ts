import type { SerialCategory } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

/** Rows per INSERT statement during an import. */
const INSERT_CHUNK_SIZE = 500;

export interface SerialRow {
  id: string;
  hint: string | null;
  category: SerialCategory;
  allowedPageId: string | null;
  allowedPageSlot: number | null;
  isActive: boolean;
}

export interface NewSerial {
  hash: string;
  hint: string;
  category: SerialCategory;
  allowedPageId: string | null;
  batchId: string;
}

export interface SerialBatchRow {
  id: string;
  sourceName: string | null;
  rowCount: number;
  activeCount: number;
  adminId: string | null;
  adminDisplayName: string | null;
  createdAt: Date;
}

/** `category` is CHECK-constrained to the SerialCategory values. */
function toSerialRow<T extends { category: string }>(row: T): T & { category: SerialCategory } {
  return { ...row, category: row.category as SerialCategory };
}

/**
 * Serial numbers are stored only as HMAC hashes. No method returns or accepts plaintext, and
 * there is deliberately no "list serials" query.
 */
export interface SerialsRepository {
  findByHash(db: Database, hash: string, lock?: boolean): Promise<SerialRow | undefined>;
  /** Which of `hashes` already exist. */
  existingHashes(db: Database, hashes: string[]): Promise<Set<string>>;
  createBatch(db: Database, batch: { adminId: string; sourceName: string | null }): Promise<string>;
  setBatchRowCount(db: Database, batchId: string, rowCount: number): Promise<void>;
  /** Inserts serials, skipping hashes that already exist; returns the hashes actually inserted. */
  insertMany(db: Database, serials: NewSerial[]): Promise<Set<string>>;
  setActive(db: Database, id: string, isActive: boolean): Promise<void>;
  listBatches(db: Database, page: PageRequest): Promise<{ rows: SerialBatchRow[]; total: number }>;
}

function serialQuery(db: Database) {
  return db
    .selectFrom('serial_numbers as s')
    .leftJoin('qr_pages as p', 'p.id', 's.allowed_page_id')
    .select([
      's.id',
      's.serial_hint as hint',
      's.category',
      's.allowed_page_id as allowedPageId',
      'p.slot_number as allowedPageSlot',
      's.is_active as isActive',
    ]);
}

export function createSerialsRepository(): SerialsRepository {
  return {
    async findByHash(db, hash, lock = false) {
      let query = serialQuery(db).where('s.serial_hash', '=', hash);
      if (lock) query = query.forUpdate('s');
      const row = await query.executeTakeFirst();
      return row && toSerialRow(row);
    },

    async existingHashes(db, hashes) {
      const found = new Set<string>();
      for (let i = 0; i < hashes.length; i += INSERT_CHUNK_SIZE) {
        const chunk = hashes.slice(i, i + INSERT_CHUNK_SIZE);
        const rows = await db
          .selectFrom('serial_numbers')
          .select('serial_hash')
          .where('serial_hash', 'in', chunk)
          .execute();
        for (const row of rows) found.add(row.serial_hash);
      }
      return found;
    },

    async createBatch(db, batch) {
      const row = await db
        .insertInto('serial_import_batches')
        .values({ admin_id: batch.adminId, source_name: batch.sourceName })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async setBatchRowCount(db, batchId, rowCount) {
      await db
        .updateTable('serial_import_batches')
        .set({ row_count: rowCount })
        .where('id', '=', batchId)
        .execute();
    },

    async insertMany(db, serials) {
      const inserted = new Set<string>();
      for (let i = 0; i < serials.length; i += INSERT_CHUNK_SIZE) {
        const chunk = serials.slice(i, i + INSERT_CHUNK_SIZE);
        const rows = await db
          .insertInto('serial_numbers')
          .values(
            chunk.map((serial) => ({
              serial_hash: serial.hash,
              serial_hint: serial.hint,
              category: serial.category,
              allowed_page_id: serial.allowedPageId,
              import_batch_id: serial.batchId,
            })),
          )
          .onConflict((oc) => oc.column('serial_hash').doNothing())
          .returning('serial_hash')
          .execute();
        for (const row of rows) inserted.add(row.serial_hash);
      }
      return inserted;
    },

    async setActive(db, id, isActive) {
      await db
        .updateTable('serial_numbers')
        .set({ is_active: isActive })
        .where('id', '=', id)
        .execute();
    },

    async listBatches(db, page) {
      const [rows, count] = await Promise.all([
        db
          .selectFrom('serial_import_batches as b')
          .leftJoin('admin_users as a', 'a.id', 'b.admin_id')
          .select((eb) => [
            'b.id',
            'b.source_name as sourceName',
            'b.row_count as rowCount',
            eb
              .selectFrom('serial_numbers as s')
              .select((sub) => sub.fn.countAll<string>().as('n'))
              .whereRef('s.import_batch_id', '=', 'b.id')
              .where('s.is_active', '=', true)
              .as('activeCount'),
            'b.admin_id as adminId',
            'a.display_name as adminDisplayName',
            'b.created_at as createdAt',
          ])
          .orderBy('b.created_at', 'desc')
          .orderBy('b.id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        db
          .selectFrom('serial_import_batches')
          .select((eb) => eb.fn.countAll<string>().as('total'))
          .executeTakeFirstOrThrow(),
      ]);
      return {
        rows: rows.map((row) => ({ ...row, activeCount: Number(row.activeCount ?? 0) })),
        total: Number(count.total),
      };
    },
  };
}
