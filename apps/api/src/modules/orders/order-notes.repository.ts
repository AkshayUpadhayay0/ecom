import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface OrderNoteRow {
  id: string;
  body: string;
  adminId: string;
  adminName: string;
  createdAt: Date;
}

/** Internal order notes: append-only (DB trigger), admin only, never in customer DTOs. */
export interface OrderNotesRepository {
  insert(db: Database, input: { orderId: string; adminId: string; body: string }): Promise<string>;
  list(db: Database, orderId: string): Promise<OrderNoteRow[]>;
}

export function createOrderNotesRepository(): OrderNotesRepository {
  return {
    async insert(db, input) {
      const row = await db
        .insertInto('order_notes')
        .values({ order_id: input.orderId, admin_id: input.adminId, body: input.body })
        .returning(sql<string>`id::text`.as('id'))
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async list(db, orderId) {
      return db
        .selectFrom('order_notes as n')
        .innerJoin('admin_users as a', 'a.id', 'n.admin_id')
        .select([
          sql<string>`n.id::text`.as('id'),
          'n.body',
          'n.admin_id as adminId',
          'a.display_name as adminName',
          'n.created_at as createdAt',
        ])
        .where('n.order_id', '=', orderId)
        .orderBy('n.id')
        .execute();
    },
  };
}
