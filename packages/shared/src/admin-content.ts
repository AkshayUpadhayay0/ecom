import { z } from 'zod';
import { paginationQuerySchema, type Translations } from './admin-common.js';

export const CONTENT_TITLE_MAX_LENGTH = 200;
export const CONTENT_BODY_MAX_LENGTH = 20_000;
export const CONTENT_CTA_MAX_LENGTH = 60;

export const contentBlockKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'must be a content block key such as home.hero');

/**
 * Replaces one language's text. `body` is Markdown; any raw HTML is stripped on write. Fields
 * left out or null are stored as empty (null).
 */
export const updateContentTranslationSchema = z.object({
  title: z.string().trim().max(CONTENT_TITLE_MAX_LENGTH).nullable().optional(),
  body: z.string().trim().max(CONTENT_BODY_MAX_LENGTH).nullable().optional(),
  ctaLabel: z.string().trim().max(CONTENT_CTA_MAX_LENGTH).nullable().optional(),
});
export type UpdateContentTranslationRequest = z.infer<typeof updateContentTranslationSchema>;

/** `null` clears the media. */
export const setContentMediaSchema = z.object({ mediaAssetId: z.uuid().nullable() });
export type SetContentMediaRequest = z.infer<typeof setContentMediaSchema>;

export const listContentBlocksQuerySchema = paginationQuerySchema;

export interface ContentTranslationDto {
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
}

export interface ContentBlockSummaryDto {
  id: string;
  key: string;
  isPublished: boolean;
  mediaAssetId: string | null;
  languages: string[];
  updatedAt: string;
  updatedBy: string | null;
}

export interface ContentBlockDto extends ContentBlockSummaryDto {
  translations: Translations<ContentTranslationDto>;
}
