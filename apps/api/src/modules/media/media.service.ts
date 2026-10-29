import { randomUUID } from 'node:crypto';
import {
  EVIDENCE_MIME_TYPES,
  MEDIA_MIME_TYPES,
  type CreateEvidenceUploadRequest,
  type CreateUploadRequest,
  type CreateUploadResultDto,
  type ListMediaQuery,
  type MediaAssetDto,
  type MediaDeletionResultDto,
  type MediaLibraryItemDto,
  type MediaMimeType,
  type MediaUsageDto,
  type MediaPickerQuery,
  type MediaUrlDto,
  type PurgeRetiredResultDto,
} from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { MediaAssetsRepository } from './media-assets.repository.js';
import { toMediaAssetDto } from './media.dto.js';
import {
  MAGIC_BYTES_LENGTH,
  bucketOf,
  matchesMagicBytes,
  originalKey,
  sanitizeFileName,
} from './media-files.js';
import type { MediaFilters, MediaRepository, MediaRow } from './media.repository.js';
import type { MediaUsageRepository, MediaUsageRows } from './media-usage.repository.js';
import type { StorageProvider } from './storage/storage-provider.js';

const ENTITY = 'media_asset';
const PRIVATE = 'private';
const MS_PER_SECOND = 1000;
/** Statuses after a verified upload: completing again is a no-op (idempotent). */
const ALREADY_COMPLETED = new Set(['uploaded', 'processing', 'ready']);

/**
 * What an admin may reach through the media routes. `library` (super_admin): every asset.
 * `product` (normal admin): only public media that no customer owns (product / content media);
 * private files and return evidence look like they do not exist (404).
 */
export type MediaScope = 'library' | 'product';

export interface MediaService {
  createUpload(
    actor: AuditActor,
    input: CreateUploadRequest,
    scope: MediaScope,
  ): Promise<CreateUploadResultDto>;
  /**
   * Verifies the stored object (exists, exact size, declared type, magic bytes), marks the asset
   * 'uploaded' and queues processing. Calling it again after success returns the same asset.
   */
  completeUpload(actor: AuditActor, id: string, scope: MediaScope): Promise<MediaAssetDto>;
  /**
   * Media Library (every admin): public media no customer owns only, for BOTH roles, with
   * "Used by" per file. Private files / return evidence are never listed here.
   */
  list(query: ListMediaQuery): Promise<Page<MediaLibraryItemDto>>;
  /** "Choose existing": public, ready, non-retired media no customer owns. */
  picker(query: MediaPickerQuery): Promise<Page<MediaAssetDto>>;
  get(id: string, scope: MediaScope): Promise<MediaAssetDto>;
  /**
   * Requeues a failed PROCESSING job of public product media (fresh attempt budget). Uploads that
   * were rejected at verification have no stored file: they need a new upload (409).
   */
  retry(actor: AuditActor, id: string, scope: MediaScope): Promise<MediaAssetDto>;
  /** Where a PUBLIC, non-customer asset is used (products, content blocks, pending, hidden pages). */
  usage(id: string, scope: MediaScope): Promise<MediaUsageDto>;
  /**
   * Delete (20 Oct 2026): detach from every product / content block / pending replacement and
   * retire, in one transaction; files stay in storage until a super admin purges them. Refused
   * for private or customer-owned media, while processing, or while a hidden page uses it.
   */
  delete(actor: AuditActor, id: string, scope: MediaScope): Promise<MediaDeletionResultDto>;
  /**
   * Library preview link: public media no customer owns only (its CDN URL). Private files and
   * return evidence are 404 here; admins see evidence only through the return request.
   */
  getUrlForAdmin(id: string): Promise<MediaUrlDto>;
  /**
   * Private media of this customer only: evidence attached to their return requests, or an
   * upload they own (preview before attaching). Everything else is a 404.
   */
  getUrlForCustomer(customerId: string, id: string): Promise<MediaUrlDto>;
  /** Customer return evidence: always private, owned by the customer, photos only. */
  createCustomerUpload(
    customerId: string,
    input: CreateEvidenceUploadRequest,
  ): Promise<CreateUploadResultDto>;
  /** Same verification as admin uploads (size, type, magic bytes); own uploads only. */
  completeCustomerUpload(customerId: string, id: string): Promise<MediaAssetDto>;
  /** Deletes the objects of ONE retired, unreferenced asset (row kept, purged_at set). */
  purge(actor: AuditActor, id: string): Promise<MediaAssetDto>;
  /** Purges every retired asset that nothing references. */
  purgeRetired(actor: AuditActor): Promise<PurgeRetiredResultDto>;
}

export interface MediaServiceDeps {
  db: Database;
  repository: MediaRepository;
  assets: MediaAssetsRepository;
  usage: MediaUsageRepository;
  storage: StorageProvider;
  settings: SettingsService;
  logger: Logger;
}

type CompleteOutcome =
  | { ok: true; row: MediaRow }
  | { ok: false; error: AppError; deleteObject: boolean; row: MediaRow };

function isMediaMimeType(value: string): value is MediaMimeType {
  return Object.hasOwn(MEDIA_MIME_TYPES, value);
}

function uploadMismatch(message: string): AppError {
  return new AppError('UPLOAD_MISMATCH', HTTP_STATUS.UNPROCESSABLE_ENTITY, message);
}

export function createMediaService(deps: MediaServiceDeps): MediaService {
  const { db, repository, storage, settings } = deps;

  async function toDto(executor: Database, row: MediaRow): Promise<MediaAssetDto> {
    const renditions = await repository.renditionsFor(executor, [row.id]);
    return toMediaAssetDto(row, renditions.get(row.id) ?? [], storage);
  }

  async function loadRow(executor: Database, id: string, lock = false): Promise<MediaRow> {
    const row = await repository.findById(executor, id, lock);
    if (!row) throw notFoundError('Media asset');
    return row;
  }

  /** Public media no customer owns: what a normal admin (product scope) may reach. */
  function isProductMedia(row: MediaRow): boolean {
    return row.visibility === 'public' && row.ownerCustomerId === null;
  }

  /** Deletion only applies to public catalogue media, never to private files / evidence. */
  function assertDeletableKind(row: MediaRow, scope: MediaScope): void {
    assertInScope(row, scope);
    if (!isProductMedia(row)) {
      throw new AppError(
        'MEDIA_DELETE_BLOCKED',
        HTTP_STATUS.CONFLICT,
        'Private media (such as return evidence) cannot be deleted here. It is kept with its return request.',
      );
    }
  }

  function blockedReasonOf(row: MediaRow, usage: MediaUsageRows): string | null {
    if (row.status === 'uploaded' || row.status === 'processing') {
      return 'This file is still being processed. Wait until it is ready (or failed), then delete it.';
    }
    if (usage.hiddenPages.length > 0) {
      return `This file is used by hidden page(s) ${usage.hiddenPages.map((p) => p.slotNumber).join(', ')}, which developers manage.`;
    }
    return null;
  }

  function usageDto(row: MediaRow, usage: MediaUsageRows): MediaUsageDto {
    const blockedReason = blockedReasonOf(row, usage);
    return {
      assetId: row.id,
      kind: row.kind,
      ...usage,
      deletable: blockedReason === null,
      blockedReason,
    };
  }

  function assertInScope(row: MediaRow, scope: MediaScope): void {
    // Out-of-scope assets are reported as missing so their existence is not revealed.
    if (scope === 'product' && !isProductMedia(row)) throw notFoundError('Media asset');
  }

  async function listWith(
    filters: MediaFilters,
    query: { page: number; pageSize?: number | undefined },
  ): Promise<Page<MediaAssetDto>> {
    const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
    const { rows, total } = await repository.list(db, filters, page);
    const renditions = await repository.renditionsFor(
      db,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => toMediaAssetDto(row, renditions.get(row.id) ?? [], storage)),
      meta: toPageMeta(page, total),
    };
  }

  /** Checks the stored object against the pending asset. Read-only (no DB writes). */
  async function verifyObject(row: MediaRow): Promise<AppError | 'missing' | undefined> {
    const bucket = bucketOf(row.visibility);
    const head = await storage.headObject(bucket, row.originalKey);
    if (!head) return 'missing';
    if (head.contentLength !== Number(row.sizeBytes)) {
      return uploadMismatch(
        `Uploaded size (${head.contentLength} bytes) differs from the declared size (${row.sizeBytes} bytes).`,
      );
    }
    // The cap may have been lowered since the upload URL was issued: enforce the current value.
    if (isMediaMimeType(row.mimeType)) {
      const { kind } = MEDIA_MIME_TYPES[row.mimeType];
      const maxBytes = await settings.getLimit(
        db,
        kind === 'video' ? 'media.max_video_bytes' : 'media.max_image_bytes',
      );
      if (head.contentLength > maxBytes) {
        return new AppError(
          'FILE_TOO_LARGE',
          HTTP_STATUS.PAYLOAD_TOO_LARGE,
          'The file is too large.',
          { maxBytes },
        );
      }
    }
    const storedType = head.contentType?.split(';')[0]?.trim().toLowerCase();
    if (storedType !== row.mimeType) {
      return uploadMismatch('Uploaded content type differs from the declared type.');
    }
    if (!isMediaMimeType(row.mimeType)) return uploadMismatch('Unsupported media type.');
    const firstBytes = await storage.readRange(bucket, row.originalKey, MAGIC_BYTES_LENGTH);
    if (!matchesMagicBytes(row.mimeType, firstBytes)) {
      return uploadMismatch('The file content does not match its declared type.');
    }
    return undefined;
  }

  async function deleteObjects(row: MediaRow): Promise<void> {
    const bucket = bucketOf(row.visibility);
    const renditions = (await repository.renditionsFor(db, [row.id])).get(row.id) ?? [];
    for (const key of [row.originalKey, ...renditions.map((r) => r.storageKey)]) {
      await storage.delete(bucket, key);
    }
  }

  async function purgeOne(actor: AuditActor, id: string): Promise<MediaRow> {
    const row = await db.transaction().execute(async (trx) => {
      const current = await loadRow(trx, id, true);
      if (current.retiredAt === null) {
        throw new AppError(
          'INVALID_STATE',
          HTTP_STATUS.CONFLICT,
          'Only retired media can be purged.',
        );
      }
      if (current.purgedAt !== null) return current;
      if ((await deps.assets.referencedIds(trx, [id])).has(id)) {
        throw new AppError(
          'MEDIA_IN_USE',
          HTTP_STATUS.CONFLICT,
          'This media is still used and cannot be purged.',
        );
      }
      await repository.markPurged(trx, id);
      await writeAuditLog(trx, {
        adminId: actor.adminId,
        action: 'media.purge',
        entityType: ENTITY,
        entityId: id,
        before: { purged: false },
        after: { purged: true, originalKey: current.originalKey },
        ipAddress: actor.ipAddress,
      });
      return { ...current, purgedAt: new Date() };
    });
    // Objects are removed after the row is committed as purged (and locked against reuse:
    // retired assets can never be assigned again).
    await deleteObjects(row);
    return row;
  }

  /**
   * Verifies and completes one pending upload. Admin actions are audited (admin_audit_logs);
   * customer uploads are logged only (the audit table records admins).
   */
  async function completeCore(
    id: string,
    actor: AuditActor | undefined,
    ownerCustomerId?: string,
    scope: MediaScope = 'library',
  ): Promise<MediaAssetDto> {
    const outcome = await db.transaction().execute(async (trx): Promise<CompleteOutcome> => {
      const row = await loadRow(trx, id, true);
      if (ownerCustomerId !== undefined && row.ownerCustomerId !== ownerCustomerId) {
        throw notFoundError('Media asset');
      }
      if (ownerCustomerId === undefined) assertInScope(row, scope);
      if (ALREADY_COMPLETED.has(row.status)) return { ok: true, row };
      if (row.status === 'failed') {
        return {
          ok: false,
          row,
          deleteObject: false,
          error: new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'This upload was rejected. Start a new upload.',
            { processingError: row.processingError },
          ),
        };
      }
      const problem = await verifyObject(row);
      if (problem === 'missing') {
        const expired = row.uploadExpiresAt !== null && row.uploadExpiresAt < new Date();
        return {
          ok: false,
          row,
          deleteObject: false,
          error: expired
            ? new AppError(
                'UPLOAD_EXPIRED',
                HTTP_STATUS.GONE,
                'The upload URL expired before the file arrived. Start a new upload.',
              )
            : new AppError(
                'UPLOAD_NOT_FOUND',
                HTTP_STATUS.CONFLICT,
                'The file has not been uploaded yet.',
              ),
        };
      }
      if (problem) {
        await repository.markFailed(trx, id, `upload rejected: ${problem.message}`);
        if (actor) {
          await writeAuditLog(trx, {
            adminId: actor.adminId,
            action: 'media.upload_rejected',
            entityType: ENTITY,
            entityId: id,
            after: { reason: problem.message },
            ipAddress: actor.ipAddress,
          });
        } else {
          deps.logger.info({ mediaAssetId: id }, 'customer upload rejected');
        }
        return { ok: false, row, deleteObject: true, error: problem };
      }
      await repository.markUploaded(trx, id);
      if (actor) {
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'media.upload_complete',
          entityType: ENTITY,
          entityId: id,
          before: { status: row.status },
          after: { status: 'uploaded' },
          ipAddress: actor.ipAddress,
        });
      }
      return { ok: true, row: await loadRow(trx, id) };
    });

    if (!outcome.ok) {
      // A rejected object is not kept (it never passed verification).
      if (outcome.deleteObject) {
        await storage.delete(bucketOf(outcome.row.visibility), outcome.row.originalKey);
      }
      throw outcome.error;
    }
    return toDto(db, outcome.row);
  }

  return {
    async createUpload(actor, input, scope) {
      if (scope === 'product' && input.visibility !== 'public') {
        throw new AppError(
          'FORBIDDEN',
          HTTP_STATUS.FORBIDDEN,
          'Only a super admin can upload private media. Product images and videos are public.',
        );
      }
      if (!isMediaMimeType(input.mimeType)) {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
          'This file type is not supported.',
          { allowed: Object.keys(MEDIA_MIME_TYPES) },
        );
      }
      const { kind, extension } = MEDIA_MIME_TYPES[input.mimeType];
      const maxBytes = await settings.getLimit(
        db,
        kind === 'video' ? 'media.max_video_bytes' : 'media.max_image_bytes',
      );
      if (input.sizeBytes > maxBytes) {
        throw new AppError(
          'FILE_TOO_LARGE',
          HTTP_STATUS.PAYLOAD_TOO_LARGE,
          'The file is too large.',
          {
            maxBytes,
          },
        );
      }
      const ttlSeconds = await settings.getLimit(db, 'media.upload_url_ttl_seconds');
      const id = randomUUID();
      const key = originalKey(kind, id, extension);

      const row = await db.transaction().execute(async (trx) => {
        const inserted = await repository.insertPending(trx, {
          id,
          kind,
          mimeType: input.mimeType,
          originalKey: key,
          sizeBytes: input.sizeBytes,
          visibility: input.visibility,
          isTemporary: input.isTemporary,
          originalFilename: sanitizeFileName(input.fileName),
          uploadExpiresAt: new Date(Date.now() + ttlSeconds * MS_PER_SECOND),
          uploadedBy: actor.adminId,
        });
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'media.upload_create',
          entityType: ENTITY,
          entityId: id,
          after: {
            kind,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            visibility: input.visibility,
          },
          ipAddress: actor.ipAddress,
        });
        return inserted;
      });

      const upload = await storage.createPresignedUpload({
        bucket: bucketOf(input.visibility),
        key,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresInSeconds: ttlSeconds,
      });
      return {
        asset: await toDto(db, row),
        upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
      };
    },

    completeUpload: (actor, id, scope) => completeCore(id, actor, undefined, scope),

    async createCustomerUpload(customerId, input) {
      const mimeType = input.mimeType;
      if (
        !(EVIDENCE_MIME_TYPES as readonly string[]).includes(mimeType) ||
        !isMediaMimeType(mimeType)
      ) {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
          'Evidence must be a photo (JPEG, PNG or WebP).',
          { allowed: EVIDENCE_MIME_TYPES },
        );
      }
      const maxBytes = await settings.getLimit(db, 'returns.evidence_max_bytes');
      if (input.sizeBytes > maxBytes) {
        throw new AppError(
          'FILE_TOO_LARGE',
          HTTP_STATUS.PAYLOAD_TOO_LARGE,
          'The photo is too large.',
          {
            maxBytes,
          },
        );
      }
      const { kind, extension } = MEDIA_MIME_TYPES[mimeType];
      const ttlSeconds = await settings.getLimit(db, 'media.upload_url_ttl_seconds');
      const id = randomUUID();
      const key = originalKey(kind, id, extension);
      const row = await repository.insertPending(db, {
        id,
        kind,
        mimeType,
        originalKey: key,
        sizeBytes: input.sizeBytes,
        visibility: PRIVATE,
        isTemporary: false,
        originalFilename: sanitizeFileName(input.fileName),
        uploadExpiresAt: new Date(Date.now() + ttlSeconds * MS_PER_SECOND),
        uploadedBy: null,
        ownerCustomerId: customerId,
      });
      // No file name or customer data in the log.
      deps.logger.info(
        { mediaAssetId: id, sizeBytes: input.sizeBytes },
        'customer evidence upload created',
      );
      const upload = await storage.createPresignedUpload({
        bucket: bucketOf(PRIVATE),
        key,
        contentType: mimeType,
        contentLength: input.sizeBytes,
        expiresInSeconds: ttlSeconds,
      });
      return {
        asset: await toDto(db, row),
        upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
      };
    },

    completeCustomerUpload: (customerId, id) => completeCore(id, undefined, customerId),

    async list(query) {
      const page = await listWith(
        {
          kind: query.kind,
          status: query.status,
          // Both roles: never private files or customer-owned evidence (decision 22 Oct 2026).
          visibility: 'public',
          ownerless: true,
          mimeType: query.mimeType,
          retired: query.retired,
          unused: query.unused,
          order: query.order ?? 'desc',
        },
        query,
      );
      const usedBy = await deps.usage.usageMany(
        db,
        page.items.map((item) => item.id),
      );
      return {
        items: page.items.map((item) => ({
          ...item,
          usedBy: usedBy.get(item.id) ?? {
            products: [],
            contentBlocks: [],
            pendingReplacements: 0,
          },
        })),
        meta: page.meta,
      };
    },

    picker: (query) =>
      listWith(
        {
          kind: query.kind,
          status: 'ready',
          visibility: 'public',
          retired: false,
          ownerless: true,
          order: query.order ?? 'desc',
        },
        query,
      ),

    async get(id, scope) {
      const row = await loadRow(db, id);
      assertInScope(row, scope);
      return toDto(db, row);
    },

    async usage(id, scope) {
      const row = await loadRow(db, id);
      assertDeletableKind(row, scope);
      return usageDto(row, await deps.usage.usage(db, id));
    },

    async delete(actor, id, scope) {
      return db.transaction().execute(async (trx) => {
        const row = await loadRow(trx, id, true);
        assertDeletableKind(row, scope);
        if (row.retiredAt !== null) {
          throw new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'This media was already deleted.',
          );
        }
        const usage = await deps.usage.usage(trx, id);
        const blockedReason = blockedReasonOf(row, usage);
        if (blockedReason !== null) {
          throw new AppError('MEDIA_DELETE_BLOCKED', HTTP_STATUS.CONFLICT, blockedReason, {
            status: row.status,
            hiddenPages: usage.hiddenPages,
          });
        }
        await deps.usage.detachEverywhere(trx, id);
        const retiredAt = await deps.usage.retire(trx, id);
        const detached = { assetId: id, kind: row.kind, ...usage };
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'media.delete',
          entityType: ENTITY,
          entityId: id,
          before: { retired: false, usage },
          after: { retired: true, retiredAt: retiredAt.toISOString() },
          ipAddress: actor.ipAddress,
        });
        return { assetId: id, retiredAt: retiredAt.toISOString(), detached };
      });
    },

    async retry(actor, id, scope) {
      const row = await db.transaction().execute(async (trx) => {
        const current = await loadRow(trx, id, true);
        assertInScope(current, scope);
        // Retry is for catalogue media; customer evidence and private files are not retried here.
        if (!isProductMedia(current)) throw notFoundError('Media asset');
        if (current.status !== 'failed') {
          throw new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'Only media whose processing failed can be retried.',
            { status: current.status },
          );
        }
        if (
          current.processingAttempts === 0 ||
          current.retiredAt !== null ||
          current.purgedAt !== null
        ) {
          // Rejected at upload verification: the file was not kept. A new upload is needed.
          throw new AppError(
            'INVALID_STATE',
            HTTP_STATUS.CONFLICT,
            'This upload was rejected and its file was not kept. Upload the file again.',
            { processingError: current.processingError },
          );
        }
        await repository.requeueFailed(trx, id);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'media.processing_retry',
          entityType: ENTITY,
          entityId: id,
          before: { status: current.status, processingError: current.processingError },
          after: { status: 'uploaded' },
          ipAddress: actor.ipAddress,
        });
        return loadRow(trx, id);
      });
      return toDto(db, row);
    },

    async getUrlForAdmin(id) {
      const row = await loadRow(db, id);
      assertInScope(row, 'product');
      if (row.purgedAt !== null || !ALREADY_COMPLETED.has(row.status)) {
        throw new AppError('INVALID_STATE', HTTP_STATUS.CONFLICT, 'This media has no stored file.');
      }
      if (row.visibility === 'public') {
        return { url: storage.getPublicUrl(row.originalKey), expiresAt: null };
      }
      const ttl = await settings.getLimit(db, 'media.private_url_ttl_seconds');
      return {
        url: await storage.createPrivateSignedUrl(row.originalKey, ttl),
        expiresAt: new Date(Date.now() + ttl * MS_PER_SECOND).toISOString(),
      };
    },

    async getUrlForCustomer(customerId, id) {
      const row = await repository.findById(db, id);
      const allowed =
        row !== undefined &&
        row.visibility === 'private' &&
        row.purgedAt === null &&
        ALREADY_COMPLETED.has(row.status) &&
        (row.ownerCustomerId === customerId ||
          (await repository.isEvidenceOwnedBy(db, id, customerId)));
      // Unknown, foreign and non-evidence media all look the same.
      if (!allowed) throw notFoundError('Media asset');
      const ttl = await settings.getLimit(db, 'media.private_url_ttl_seconds');
      return {
        url: await storage.createPrivateSignedUrl(row.originalKey, ttl),
        expiresAt: new Date(Date.now() + ttl * MS_PER_SECOND).toISOString(),
      };
    },

    async purge(actor, id) {
      return toDto(db, await purgeOne(actor, id));
    },

    async purgeRetired(actor) {
      const candidates = await repository.listRetiredUnpurged(db);
      const inUse = await deps.assets.referencedIds(
        db,
        candidates.map((row) => row.id),
      );
      const purged: string[] = [];
      for (const row of candidates) {
        if (inUse.has(row.id)) continue;
        try {
          await purgeOne(actor, row.id);
          purged.push(row.id);
        } catch (err) {
          // Became referenced in between (MEDIA_IN_USE) or storage failed: keep going.
          deps.logger.warn({ err, mediaAssetId: row.id }, 'media purge skipped');
        }
      }
      return {
        purged,
        skippedInUse: candidates.filter((row) => inUse.has(row.id)).map((row) => row.id),
      };
    },
  };
}
