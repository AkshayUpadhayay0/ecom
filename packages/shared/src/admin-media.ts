import { z } from 'zod';
import { booleanQuerySchema, paginationQuerySchema } from './admin-common.js';

/**
 * Accepted upload types (technical allow-list; size limits are settings). Each MIME maps to its
 * media kind and the file extension used in the generated object key.
 */
export const MEDIA_MIME_TYPES = {
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/quicktime': { kind: 'video', extension: 'mov' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
} as const;
export type MediaMimeType = keyof typeof MEDIA_MIME_TYPES;
export const MEDIA_KINDS = ['video', 'image'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_VISIBILITIES = ['public', 'private'] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];
export const MEDIA_STATUSES = ['pending', 'uploaded', 'processing', 'ready', 'failed'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

const FILE_NAME_MAX_LENGTH = 255;

/** POST /admin/media/uploads. Type and size are re-checked against the stored object later. */
export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(FILE_NAME_MAX_LENGTH),
  mimeType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.number().int().min(1),
  /** private = never public (e.g. return evidence); stored in the private bucket. */
  visibility: z.enum(MEDIA_VISIBILITIES).default('public'),
  /** Temporary videos are replaced later (client requirement). */
  isTemporary: z.boolean().default(false),
});
export type CreateUploadRequest = z.infer<typeof createUploadSchema>;

/** [TEAM DESIGN 16 Oct 2026] return evidence: photos only. */
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * POST /me/media/uploads (customer return evidence). Always private and owned by the customer;
 * visibility cannot be chosen by the client.
 */
export const createEvidenceUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(FILE_NAME_MAX_LENGTH),
    mimeType: z.string().trim().toLowerCase().min(1).max(100),
    sizeBytes: z.number().int().min(1),
  })
  .strict();
export type CreateEvidenceUploadRequest = z.infer<typeof createEvidenceUploadSchema>;

/**
 * GET /admin/media (Media Library, every admin since 22 Oct 2026). Lists PUBLIC media that no
 * customer owns only, for both roles: private files and return evidence are never listed here.
 */
export const listMediaQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(MEDIA_KINDS).optional(),
  status: z.enum(MEDIA_STATUSES).optional(),
  mimeType: z.string().trim().toLowerCase().max(100).optional(),
  retired: booleanQuerySchema.optional(),
  /** true = not used by any product, content block, pending replacement or hidden page. */
  unused: booleanQuerySchema.optional(),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

/**
 * GET /admin/media/picker ("Choose existing" in the product form, every admin): public, ready,
 * non-retired media that no customer owns. Never private files or return evidence.
 */
export const mediaPickerQuerySchema = paginationQuerySchema
  .extend({ kind: z.enum(MEDIA_KINDS).optional() })
  .strict();
export type MediaPickerQuery = z.infer<typeof mediaPickerQuerySchema>;

export interface MediaRenditionDto {
  label: string;
  format: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  /** Public assets only; private renditions are reached through a signed URL. */
  url: string | null;
}

export interface MediaAssetDto {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
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
  /** Public URL of the original upload; always null for private media. */
  publicUrl: string | null;
  renditions: MediaRenditionDto[];
  createdAt: string;
  uploadedAt: string | null;
  retiredAt: string | null;
  purgedAt: string | null;
}

/** A Media Library row: the asset plus where it is used ("Used by"). */
export interface MediaLibraryItemDto extends MediaAssetDto {
  usedBy: {
    products: { id: string; name: string; as: 'video' | 'image' }[];
    contentBlocks: { key: string }[];
    /** Pending product replacements containing it. */
    pendingReplacements: number;
  };
}

export interface PresignedUploadDto {
  url: string;
  method: 'PUT';
  /** Send exactly these headers with the PUT (the signature covers them). */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface CreateUploadResultDto {
  asset: MediaAssetDto;
  upload: PresignedUploadDto;
}

export interface MediaUrlDto {
  url: string;
  /** null for public media (stable CDN URL). */
  expiresAt: string | null;
}

export interface PurgeRetiredResultDto {
  purged: string[];
  /** Retired but still referenced somewhere: never purged. */
  skippedInUse: string[];
}

/** GET /admin/media/:id/usage: where a PUBLIC asset is used (what deleting it would change). */
export interface MediaUsageDto {
  assetId: string;
  kind: MediaKind;
  products: { id: string; name: string; as: 'video' | 'image' }[];
  contentBlocks: { key: string }[];
  /** Pending product replacements containing it (they are cancelled by a delete). */
  pendingReplacements: { productId: string; productName: string; slot: 'video' | 'images' }[];
  /** Deletion is refused while a hidden page uses it (developer-managed). */
  hiddenPages: { slotNumber: number }[];
  deletable: boolean;
  /** Why it cannot be deleted now (processing, hidden page), else null. */
  blockedReason: string | null;
}

/** DELETE /admin/media/:id: detached everywhere and retired; files stay until a purge. */
export interface MediaDeletionResultDto {
  assetId: string;
  retiredAt: string;
  detached: Omit<MediaUsageDto, 'deletable' | 'blockedReason'>;
}
