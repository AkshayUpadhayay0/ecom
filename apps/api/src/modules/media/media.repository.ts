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
  /**
   * Poster, preview and the smallest rendition exist: the storefront may show the video with the
   * renditions that exist, even while processingStatus is not 'ready' yet. Stays set on a later
   * failure or retry (then processingError is the warning).
   */
  playableAt: Date | null;
  uploadExpiresAt: Date | null;
  uploadedAt: Date | null;
  retiredAt: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
  /** Customer who uploaded it (return evidence); null for admin uploads. */
  ownerCustomerId: string | null;
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
  ownerCustomerId?: string | null;
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
  /** true = only media no customer owns and not purged (excludes return evidence uploads). */
  ownerless?: boolean | undefined;
  /** true = not referenced by any product, content block, pending replacement or hidden page. */
  unused?: boolean | undefined;
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
  'playable_at as playableAt',
  'upload_expires_at as uploadExpiresAt',
  'uploaded_at as uploadedAt',
  'retired_at as retiredAt',
  'purged_at as purgedAt',
  'created_at as createdAt',
  'owner_customer_id as ownerCustomerId',
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
  /**
   * Early-ready: the asset becomes playable. Stores what is known so far (metadata and the first
   * renditions) without changing processing_status ('ready' still means ALL renditions are done).
   */
  markPlayable(db: Database, id: string, result: ProcessingResult): Promise<void>;
  /** Adds (or replaces, same label and format) one rendition of an asset that is already playable. */
  addRendition(db: Database, id: string, rendition: NewRendition): Promise<void>;
  completeProcessing(db: Database, id: string, result: ProcessingResult): Promise<void>;
  scheduleRetry(db: Database, id: string, error: string, retryAt: Date): Promise<void>;
  failProcessing(db: Database, id: string, error: string): Promise<void>;
  /** Admin retry of a failed processing job: back in the queue with a fresh attempt budget. */
  requeueFailed(db: Database, id: string): Promise<void>;
  /** Retired, not yet purged assets (purge candidates). */
  listRetiredUnpurged(db: Database): Promise<MediaRow[]>;
  markPurged(db: Database, id: string): Promise<void>;
  /** True if the asset is evidence on a return request owned by the customer. */
  isEvidenceOwnedBy(db: Database, assetId: string, customerId: string): Promise<boolean>;
}

async function insertRendition(db: Database, id: string, r: NewRendition): Promise<void> {
  await db
    .deleteFrom('media_renditions')
    .where('asset_id', '=', id)
    .where('label', '=', r.label)
    .where('format', '=', r.format)
    .execute();
  await db
    .insertInto('media_renditions')
    .values({
      asset_id: id,
      label: r.label,
      format: r.format,
      storage_key: r.storageKey,
      width: r.width,
      height: r.height,
      bitrate_kbps: r.bitrateKbps,
      size_bytes: r.sizeBytes,
    })
    .execute();
}

const truncate = (error: string): string => error.slice(0, ERROR_MAX_LENGTH);

/** Postgres NOTIFY channel the worker LISTENs on: "a media job is ready to claim". */
export const MEDIA_JOBS_CHANNEL = 'media_jobs';

/**
 * Wakes the worker at once. pg_notify inside the caller's transaction is delivered only when that
 * transaction commits, so the worker never wakes for a job it cannot see yet.
 */
async function notifyJob(db: Database, id: string): Promise<void> {
  await sql`SELECT pg_notify(${MEDIA_JOBS_CHANNEL}, ${id})`.execute(db);
}

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
          owner_customer_id: asset.ownerCustomerId ?? null,
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
      if (filters.ownerless === true) {
        query = query.where('owner_customer_id', 'is', null).where('purged_at', 'is', null);
      }
      if (filters.unused === true) {
        query = query.where(
          sql<boolean>`NOT EXISTS (SELECT 1 FROM products p
                                    WHERE p.video_asset_id = media_assets.id AND p.deleted_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.media_asset_id = media_assets.id)
            AND NOT EXISTS (SELECT 1 FROM content_blocks cb WHERE cb.media_asset_id = media_assets.id)
            AND NOT EXISTS (SELECT 1 FROM qr_pages q WHERE q.media_asset_id = media_assets.id)
            AND NOT EXISTS (SELECT 1 FROM product_pending_media pm
                             WHERE media_assets.id = ANY(pm.asset_ids))`,
        );
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
      await notifyJob(db, id);
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

    async markPlayable(db, id, result) {
      for (const rendition of result.renditions) await insertRendition(db, id, rendition);
      await db
        .updateTable('media_assets')
        .set({
          playable_at: sql<Date>`COALESCE(playable_at, now())`,
          duration_ms: result.durationMs,
          width: result.width,
          height: result.height,
          dominant_color: result.dominantColor,
        })
        .where('id', '=', id)
        .execute();
    },

    async addRendition(db, id, rendition) {
      await insertRendition(db, id, rendition);
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
          playable_at: sql<Date>`COALESCE(playable_at, now())`,
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

    async requeueFailed(db, id) {
      await db
        .updateTable('media_assets')
        .set({
          processing_status: 'uploaded',
          processing_attempts: 0,
          processing_error: null,
          processing_started_at: null,
          next_attempt_at: new Date(),
        })
        .where('id', '=', id)
        .where('processing_status', '=', 'failed')
        .execute();
      await notifyJob(db, id);
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
