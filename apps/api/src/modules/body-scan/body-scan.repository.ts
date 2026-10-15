import { sql } from 'kysely';
import type { BodyScanStatus } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';

export interface BodyScanRow {
  id: string;
  customerId: string;
  productId: string;
  status: BodyScanStatus;
  provider: string | null;
  externalRef: string | null;
  resultMeasurements: unknown;
  failureReason: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
}

const FAILURE_REASON_MAX_LENGTH = 500;

const COLUMNS = [
  'id',
  'customer_id as customerId',
  'product_id as productId',
  'status',
  'provider',
  'external_ref as externalRef',
  'result_measurements as resultMeasurements',
  'failure_reason as failureReason',
  'expires_at as expiresAt',
  'completed_at as completedAt',
] as const;

/** `status` is CHECK-constrained to the BodyScanStatus values. */
function toRow<T extends { status: string }>(row: T): T & { status: BodyScanStatus } {
  return { ...row, status: row.status as BodyScanStatus };
}

/** body_scan_sessions. A finished session cannot change status (DB trigger). */
export interface BodyScanRepository {
  create(
    db: Database,
    input: { customerId: string; productId: string; provider: string; expiresAt: Date },
  ): Promise<BodyScanRow>;
  markStarted(db: Database, id: string, externalRef: string): Promise<BodyScanRow>;
  markCompleted(
    db: Database,
    id: string,
    measurements: Record<string, number>,
  ): Promise<BodyScanRow>;
  markFailed(db: Database, id: string, reason: string): Promise<BodyScanRow>;
  findOwned(db: Database, id: string, customerId: string): Promise<BodyScanRow | undefined>;
  findByExternalRef(
    db: Database,
    provider: string,
    externalRef: string,
  ): Promise<BodyScanRow | undefined>;
}

export function createBodyScanRepository(): BodyScanRepository {
  return {
    async create(db, input) {
      const row = await db
        .insertInto('body_scan_sessions')
        .values({
          customer_id: input.customerId,
          product_id: input.productId,
          provider: input.provider,
          expires_at: input.expiresAt,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toRow(row);
    },

    async markStarted(db, id, externalRef) {
      const row = await db
        .updateTable('body_scan_sessions')
        .set({ status: 'IN_PROGRESS', external_ref: externalRef })
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toRow(row);
    },

    async markCompleted(db, id, measurements) {
      const row = await db
        .updateTable('body_scan_sessions')
        .set({
          status: 'COMPLETED',
          result_measurements: JSON.stringify(measurements),
          completed_at: sql`now()`,
        })
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toRow(row);
    },

    async markFailed(db, id, reason) {
      const row = await db
        .updateTable('body_scan_sessions')
        .set({ status: 'FAILED', failure_reason: reason.slice(0, FAILURE_REASON_MAX_LENGTH) })
        .where('id', '=', id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toRow(row);
    },

    async findOwned(db, id, customerId) {
      const row = await db
        .selectFrom('body_scan_sessions')
        .select(COLUMNS)
        .where('id', '=', id)
        .where('customer_id', '=', customerId)
        .executeTakeFirst();
      return row && toRow(row);
    },

    async findByExternalRef(db, provider, externalRef) {
      const row = await db
        .selectFrom('body_scan_sessions')
        .select(COLUMNS)
        .where('provider', '=', provider)
        .where('external_ref', '=', externalRef)
        .executeTakeFirst();
      return row && toRow(row);
    },
  };
}
