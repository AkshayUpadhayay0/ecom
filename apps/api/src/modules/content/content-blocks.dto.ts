import type { ContentBlockDto, ContentBlockSummaryDto } from '@urban-ibile/shared';
import type { ContentBlockRow, ContentTranslationRow } from './content-blocks.repository.js';

export function toContentBlockSummaryDto(
  row: ContentBlockRow,
  translations: ContentTranslationRow[],
): ContentBlockSummaryDto {
  return {
    id: row.id,
    key: row.key,
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
