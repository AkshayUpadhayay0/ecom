import { z } from 'zod';
import { MAX_PAGE_SIZE, slugSchema, type Translations } from './admin-common.js';

/*
 * Public (customer-facing) API contract, shared by the web app (framework pending) and the React
 * Native app. Only public data: no stock counts, costs, admin fields, storage keys or retired media.
 */

export const CATALOG_SORTS = ['newest', 'price_asc', 'price_desc', 'name'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Longest accepted search text (characters, after trimming). */
export const SEARCH_MAX_LENGTH = 100;

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
};

export const catalogQuerySchema = z.object({
  ...pageQuery,
  sort: z.enum(CATALOG_SORTS).default('newest'),
  /** Clothing type slug. */
  clothingType: slugSchema.optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const catalogSearchQuerySchema = z.object({
  ...pageQuery,
  sort: z.enum(CATALOG_SORTS).default('newest'),
  q: z.string().trim().min(1, 'Enter a search word').max(SEARCH_MAX_LENGTH),
});
export type CatalogSearchQuery = z.infer<typeof catalogSearchQuerySchema>;

/** Product id (uuid) or slug. */
export const productRefSchema = z.union([z.uuid(), slugSchema]);

export interface PublicVideoSourceDto {
  /** e.g. "720p" (short side of the frame). */
  label: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Grid media: poster + muted loop + 480p/720p MP4. */
export interface PublicGridMediaDto {
  posterUrl: string | null;
  previewUrl: string | null;
  mp4: PublicVideoSourceDto[];
  /** "#rrggbb" placeholder while media loads. */
  dominantColor: string | null;
}

export interface PublicClothingTypeRefDto {
  slug: string;
  name: string | null;
}

export interface PublicProductCardDto {
  id: string;
  slug: string;
  /** Never translated. */
  name: string;
  clothingType: PublicClothingTypeRefDto;
  priceMinor: number;
  currency: string;
  /** At least one size can be bought right now (no quantities are exposed). */
  inStock: boolean;
  /** Ready video only; null while the video is processing or when there is none. */
  media: PublicGridMediaDto | null;
  /**
   * First ready product image: the fallback to show when `media` is null (no broken player while
   * a new video is still processing). null when no image is ready either.
   */
  image: PublicImageDto | null;
}

export interface PublicPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicProductListDto {
  data: PublicProductCardDto[];
  meta: PublicPageMeta;
}

/** Search answers 200 with an empty list and this code when nothing matched. */
export const SEARCH_NO_RESULTS = 'NO_RESULTS';

export interface PublicSearchResultDto extends PublicProductListDto {
  query: string;
  code?: typeof SEARCH_NO_RESULTS;
}

export interface PublicVideoDto extends PublicGridMediaDto {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export interface PublicImageDto {
  dominantColor: string | null;
  width: number | null;
  height: number | null;
  /** WebP variants, smallest first. */
  variants: { width: number | null; height: number | null; url: string }[];
}

export type SizeAvailability = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface PublicSizeOptionDto {
  sizeCode: string;
  label: string;
  availability: SizeAvailability;
}

export interface PublicMeasurementDto {
  code: string;
  label: string;
  helpText: string | null;
}

export interface PublicProductDetailDto extends PublicProductCardDto {
  description: string | null;
  videos: PublicVideoDto[];
  images: PublicImageDto[];
  sizes: PublicSizeOptionDto[];
  /**
   * Blueprint fit: when required, the customer enters these measurements (Phase 5 engine
   * recommends the size). The raw size chart is never exposed.
   */
  blueprint: {
    required: boolean;
    profile: { code: string; name: string; measurements: PublicMeasurementDto[] } | null;
  };
}

export interface PublicClothingTypeDto {
  slug: string;
  name: string | null;
}

export interface PublicDeliveryZoneDto {
  code: string;
  name: string;
  feeMinor: number;
  estDaysMin: number | null;
  estDaysMax: number | null;
}

export interface PublicHeroDto {
  video: PublicVideoDto | null;
  /** Copy per language (static site copy; product names are never translated). */
  translations: Translations<{
    title: string | null;
    body: string | null;
    ctaLabel: string | null;
  }>;
}

export interface PublicSiteConfigDto {
  /** Allow-listed public settings only (NULL = not provided yet). */
  settings: Record<string, unknown>;
  hero: PublicHeroDto | null;
  deliveryZones: PublicDeliveryZoneDto[];
  defaultLanguage: string;
  languages: string[];
}

/** Settings the storefront may read. Everything else stays private. */
export const PUBLIC_SETTING_KEYS = [
  'catalog.page_size',
  'cart.max_quantity_per_item',
  'support.email',
  'support.phone',
  'support.whatsapp',
  'social.links',
  'brand.palette',
  'policy.returns_content_key',
] as const;

/**
 * GET /site/content/:key (published text blocks: footer, policies). Plain strings only, never
 * HTML: render each part as escaped text. `pending` = the client has not supplied the copy yet.
 */
export interface PublicContentBlockDto {
  key: string;
  status: 'pending' | 'available';
  title: string | null;
  parts: { type: 'heading' | 'paragraph'; text: string }[];
  updatedAt: string;
}
