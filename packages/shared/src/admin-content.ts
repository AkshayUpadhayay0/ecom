import { z } from 'zod';
import { paginationQuerySchema, type Translations } from './admin-common.js';

export const contentBlockKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'must be a content block key such as home.hero');

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
