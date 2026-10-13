import { z } from 'zod';
import { paginationQuerySchema } from './admin-common.js';

export const HIDDEN_PAGE_TITLE_MAX_LENGTH = 200;
export const HIDDEN_PAGE_BODY_MAX_LENGTH = 20_000;
/** Longest serial accepted for hashing (technical guard; client serials are much shorter). */
export const SERIAL_MAX_LENGTH = 128;

export const SERIAL_CATEGORIES = ['GENERAL', 'EXCLUSIVE'] as const;
export type SerialCategory = (typeof SERIAL_CATEGORIES)[number];

/** Printed in the QR code; identifies a page but is NOT a secret. */
export const routeTokenSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a route token');

// ---------- Public ----------

/**
 * Serial attempt. Any string is accepted here; empty, too long and unknown serials all get the
 * same generic SERIAL_NOT_VALID answer from the service.
 */
export const unlockHiddenPageSchema = z.object({ serial: z.string().max(SERIAL_MAX_LENGTH * 8) });
export type UnlockHiddenPageRequest = z.infer<typeof unlockHiddenPageSchema>;

export interface HiddenPageContentDto {
  title: string;
  body: string;
}

/** GET/POST answer: locked pages reveal nothing but their lock state. */
export type HiddenPageStateDto = { locked: true } | { locked: false; page: HiddenPageContentDto };

// ---------- Admin ----------

export const updateHiddenPageContentSchema = z.object({
  title: z.string().trim().min(1).max(HIDDEN_PAGE_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(HIDDEN_PAGE_BODY_MAX_LENGTH),
});
export type UpdateHiddenPageContentRequest = z.infer<typeof updateHiddenPageContentSchema>;

export const listHiddenPagesQuerySchema = paginationQuerySchema;

export interface AdminHiddenPageDto {
  id: string;
  slotNumber: number;
  slug: string;
  /** Stable; never changes when content changes. */
  routeToken: string;
  /** What the QR code encodes. The final domain is a Pending Client Decision. */
  publicUrl: string;
  exclusiveOnly: boolean;
  isPublished: boolean;
  tokenLockedAt: string | null;
  title: string | null;
  body: string | null;
  updatedAt: string;
}

/** Deactivate by the serial's value: the API never lists serials. */
export const deactivateSerialSchema = z.object({
  serial: z
    .string()
    .min(1)
    .max(SERIAL_MAX_LENGTH * 8),
});
export type DeactivateSerialRequest = z.infer<typeof deactivateSerialSchema>;

export interface SerialDto {
  id: string;
  /** Masked, e.g. `****4821`. The plaintext serial is never returned. */
  hint: string | null;
  category: SerialCategory;
  allowedPageSlot: number | null;
  isActive: boolean;
}

export const serialImportQuerySchema = z.object({
  sourceName: z.string().trim().min(1).max(200).optional(),
  dryRun: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});
export type SerialImportQuery = z.infer<typeof serialImportQuerySchema>;

export interface SerialImportRowIssueDto {
  /** 1-based line number in the uploaded CSV (the header is line 1). */
  line: number;
  hint: string | null;
  reason: string;
}

export interface SerialImportResultDto {
  batchId: string | null;
  dryRun: boolean;
  totalRows: number;
  imported: number;
  byCategory: Record<SerialCategory, number>;
  duplicates: SerialImportRowIssueDto[];
  invalid: SerialImportRowIssueDto[];
}

export const listSerialBatchesQuerySchema = paginationQuerySchema;

export interface SerialBatchDto {
  id: string;
  sourceName: string | null;
  rowCount: number;
  activeCount: number;
  admin: { id: string; displayName: string } | null;
  createdAt: string;
}
