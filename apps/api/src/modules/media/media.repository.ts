import { sql } from 'kysely';
import type { MediaKind, MediaStatus, MediaVisibility } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import type { PageRequest } from '../../lib/pagination.js';

export interface MediaRow {
  id: string;
  kind: MediaKind;
  mimeType: string;
  originalKey: string;
  sizeBytes: string;
  visibility: MediaVisibility;
  status: MediaStatus;
  isTemporary: boolean;
  originalFilename: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  processingAttempts: number;
  processingError: string | null;
  uploadExpiresAt: Date | null;
  uploadedAt: Date | null;
  retiredAt: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
}

export interface RenditionRow {
  assetId: string;
  label: string;
  format: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  sizeBytes: string | null;
}

export interface NewMediaAsset {
  id: string;
  kind: MediaKind;
  mimeType: string;
  originalKey: string;
  sizeBytes: number;
  visibility: MediaVisibility;
  isTemporary: boolean;
  originalFilename: string;
  uploadExpiresAt: Date;
  uploadedBy: string | null;
}

export interface NewRendition {
  label: string;
  format: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  sizeBytes: number;
}

export interface ProcessingResult {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  renditions: NewRendition[];
}

export interface MediaFilters {
  kind?: MediaKind | undefined;
  status?: MediaStatus | undefined;
  visibility?: MediaVisibility | undefined;
  mimeType?: string | undefined;
  retired?: boolean | undefined;
  order: 'asc' | 'desc';
}

const COLUMNS = [
  'id',
  'kind',
  'mime_type as mimeType',
  'original_key as originalKey',
  'size_bytes as sizeBytes',
  'visibility',
  'processing_status as status',
  'is_temporary as isTemporary',
  'original_filename as originalFilename',
  'duration_ms as durationMs',
  'width',
  'height',
  'dominant_color as dominantColor',
  'processing_attempts as processingAttempts',
  'processing_error as processingError',
  'upload_expires_at as uploadExpiresAt',
  'uploaded_at as uploadedAt',
  'retired_at as retiredAt',
  'purged_at as purgedAt',
  'created_at as createdAt',
] as const;

/** kind / visibility / status are CHECK-constrained to these values. */
function toMediaRow<T extends { kind: string; visibility: string; status: string }>(
  row: T,
): T & { kind: MediaKind; visibility: MediaVisibility; status: MediaStatus } {
  return {
    ...row,
    kind: row.kind as MediaKind,
    visibility: row.visibility as MediaVisibility,
    status: row.status as MediaStatus,
  };
}

const ERROR_MAX_LENGTH = 1000;

/** Upload + processing lifecycle of media_assets (the worker queue lives here too). */
export interface MediaRepository {
  insertPending(db: Database, asset: NewMediaAsset): Promise<MediaRow>;
  findById(db: Database, id: string, lock?: boolean): Promise<MediaRow | undefined>;
  list(
    db: Database,
    filters: MediaFilters,
    page: PageRequest,
  ): Promise<{ rows: MediaRow[]; total: number }>;
  renditionsFor(db: Database, assetIds: string[]): Promise<Map<string, RenditionRow[]>>;
  markUploaded(db: Database, id: string): Promise<void>;
  markFailed(db: Database, id: string, error: string): Promise<void>;
  /**
   * Claims ONE queued asset (status 'uploaded', due now) for processing with FOR UPDATE SKIP
   * LOCKED, so concurrent workers never claim the same asset. Increments the attempt counter.
   */
  claimNext(db: Database, kinds: readonly MediaKind[]): Promise<MediaRow | undefined>;
  /** Requeues (or fails, at the attempt limit) jobs whose lease ran out. Returns how many. */
  recoverStale(db: Database, leaseSeconds: number, maxAttempts: number): Promise<number>;
  completeProcessing(db: Database, id: string, result: ProcessingResult): Promise<void>;
  scheduleRetry(db: Database, id: string, error: string, retryAt: Date): Promise<void>;
  failProcessing(db: Database, id: string, error: string): Promise<void>;
  /** Retired, not yet purged assets (purge candidates). */
  listRetiredUnpurged(db: Database): Promise<MediaRow[]>;
  markPurged(db: Database, id: string): Promise<void>;
  /** True if the asset is evidence on a return request owned by the customer. */
  isEvidenceOwnedBy(db: Database, assetId: string, customerId: string): Promise<boolean>;
}

const truncate = (error: string): string => error.slice(0, ERROR_MAX_LENGTH);

export function createMediaRepository(): MediaRepository {
  async function findById(db: Database, id: string, lock = false) {
    let query = db.selectFrom('media_assets').select(COLUMNS).where('id', '=', id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row && toMediaRow(row);
  }

  return {
    async insertPending(db, asset) {
      const row = await db
        .insertInto('media_assets')
        .values({
          id: asset.id,
          kind: asset.kind,
          mime_type: asset.mimeType,
          original_key: asset.originalKey,
          size_bytes: asset.sizeBytes,
          visibility: asset.visibility,
          is_temporary: asset.isTemporary,
          original_filename: asset.originalFilename,
          upload_expires_at: asset.uploadExpiresAt,
          uploaded_by: asset.uploadedBy,
          processing_status: 'pending',
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toMediaRow(row);
    },

    findById,

    async list(db, filters, page) {
      let query = db.selectFrom('media_assets');
      if (filters.kind !== undefined) query = query.where('kind', '=', filters.kind);
      if (filters.status !== undefined)
        query = query.where('processing_status', '=', filters.status);
      if (filters.visibility !== undefined)
        query = query.where('visibility', '=', filters.visibility);
      if (filters.mimeType !== undefined) query = query.where('mime_type', '=', filters.mimeType);
      if (filters.retired !== undefined) {
        query = query.where('retired_at', filters.retired ? 'is not' : 'is', null);
      }
      const [rows, count] = await Promise.all([
        query
          .select(COLUMNS)
          .orderBy('created_at', filters.order)
          .orderBy('id')
          .limit(page.pageSize)
          .offset(page.offset)
          .execute(),
        query.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
      ]);
      return { rows: rows.map(toMediaRow), total: Number(count.total) };
    },

    async renditionsFor(db, assetIds) {
      const result = new Map<string, RenditionRow[]>(assetIds.map((id) => [id, []]));
      if (assetIds.length === 0) return result;
      const rows = await db
        .selectFrom('media_renditions')
        .select([
          'asset_id as assetId',
          'label',
          'format',
          'storage_key as storageKey',
          'width',
          'height',
          'bitrate_kbps as bitrateKbps',
          'size_bytes as sizeBytes',
        ])
        .where('asset_id', 'in', assetIds)
        .orderBy('format')
        .orderBy('height')
        .orderBy('width')
        .execute();
      for (const row of rows) result.get(row.assetId)?.push(row);
      return result;
    },

    async markUploaded(db, id) {
      await db
        .updateTable('media_assets')
        .set({
          processing_status: 'uploaded',
          uploaded_at: sql`now()`,
          next_attempt_at: sql`now()`,
          processing_attempts: 0,
          processing_error: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async markFailed(db, id, error) {
      await db
        .updateTable('media_assets')
        .set({ processing_status: 'failed', processing_error: truncate(error) })
        .where('id', '=', id)
        .execute();
    },

    async claimNext(db, kinds) {
      if (kinds.length === 0) return undefined;
      const result = await sql<{ id: string }>`
        UPDATE media_assets AS m
        SET processing_status = 'processing',
            processing_attempts = m.processing_attempts + 1,
            processing_started_at = now()
        WHERE m.id = (
          SELECT id FROM media_assets
          WHERE processing_status = 'uploaded'
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
            AND kind = ANY(${[...kinds]}::text[])
          ORDER BY next_attempt_at NULLS FIRST, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1)
        RETURNING m.id`.execute(db);
      const claimed = result.rows[0];
      return claimed ? findById(db, claimed.id) : undefined;
    },

    async recoverStale(db, leaseSeconds, maxAttempts) {
      const result = await sql`
        UPDATE media_assets
        SET processing_status = CASE WHEN processing_attempts >= ${maxAttempts}
                                     THEN 'failed' ELSE 'uploaded' END,
            next_attempt_at = now(),
            processing_error = 'Processing was interrupted (worker stopped or timed out).'
        WHERE processing_status = 'processing'
          AND processing_started_at < now() - make_interval(secs => ${leaseSeconds})`.execute(db);
      return Number(result.numAffectedRows ?? 0);
    },

    async completeProcessing(db, id, result) {
      await db.deleteFrom('media_renditions').where('asset_id', '=', id).execute();
      if (result.renditions.length > 0) {
        await db
          .insertInto('media_renditions')
          .values(
            result.renditions.map((r) => ({
              asset_id: id,
              label: r.label,
              format: r.format,
              storage_key: r.storageKey,
              width: r.width,
              height: r.height,
              bitrate_kbps: r.bitrateKbps,
              size_bytes: r.sizeBytes,
            })),
          )
          .execute();
      }
      await db
        .updateTable('media_assets')
        .set({
          processing_status: 'ready',
          duration_ms: result.durationMs,
          width: result.width,
          height: result.height,
          dominant_color: result.dominantColor,
          processing_error: null,
          processing_started_at: null,
          next_attempt_at: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async scheduleRetry(db, id, error, retryAt) {
      await db
        .updateTable('media_assets')
        .set({
          processing_status: 'uploaded',
          processing_error: truncate(error),
          next_attempt_at: retryAt,
          processing_started_at: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async failProcessing(db, id, error) {
      await db
        .updateTable('media_assets')
        .set({
          processing_status: 'failed',
          processing_error: truncate(error),
          processing_started_at: null,
          next_attempt_at: null,
        })
        .where('id', '=', id)
        .execute();
    },

    async listRetiredUnpurged(db) {
      const rows = await db
        .selectFrom('media_assets')
        .select(COLUMNS)
        .where('retired_at', 'is not', null)
        .where('purged_at', 'is', null)
        .orderBy('retired_at')
        .execute();
      return rows.map(toMediaRow);
    },

    async markPurged(db, id) {
      await db
        .updateTable('media_assets')
        .set({ purged_at: sql`now()` })
        .where('id', '=', id)
        .execute();
    },

    async isEvidenceOwnedBy(db, assetId, customerId) {
      const row = await db
        .selectFrom('return_request_media as rm')
        .innerJoin('return_requests as rr', 'rr.id', 'rm.return_request_id')
        .select('rm.id')
        .where('rm.media_asset_id', '=', assetId)
        .where('rr.customer_id', '=', customerId)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
