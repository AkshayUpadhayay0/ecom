import {
  CONTENT_TEXT_LANGUAGE,
  type ContentBlockDto,
  type ContentBlockSummaryDto,
} from '@urban-ibile/shared';
import type { ContentBlockRow, ContentTranslationRow } from './content-blocks.repository.js';

/** A text block whose English body is still empty: "Pending client content". */
export function isPendingText(translations: readonly ContentTranslationRow[]): boolean {
  const english = translations.find((t) => t.languageCode === CONTENT_TEXT_LANGUAGE);
  return english?.body == null || english.body.trim() === '';
}

export function toContentBlockSummaryDto(
  row: ContentBlockRow,
  translations: ContentTranslationRow[],
): ContentBlockSummaryDto {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    pending: row.kind === 'text' && isPendingText(translations),
    isPublished: row.isPublished,
    mediaAssetId: row.mediaAssetId,
    languages: translations.map((translation) => translation.languageCode),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export function toContentBlockDto(
  row: ContentBlockRow,
  translations: ContentTranslationRow[],
): ContentBlockDto {
  return {
    ...toContentBlockSummaryDto(row, translations),
    translations: Object.fromEntries(
      translations.map(({ languageCode, title, body, ctaLabel }) => [
        languageCode,
        { title, body, ctaLabel },
      ]),
    ),
  };
}
