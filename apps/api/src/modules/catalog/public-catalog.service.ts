import {
  SEARCH_NO_RESULTS,
  type CatalogQuery,
  type CatalogSearchQuery,
  type PublicClothingTypeDto,
  type PublicProductCardDto,
  type PublicProductDetailDto,
  type PublicProductListDto,
  type PublicSearchResultDto,
  type SizeAvailability,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest } from '../../lib/pagination.js';
import { toGridMedia, toImage, toVideo } from '../media/public-media.dto.js';
import { loadUsableMedia, type UsableMedia } from '../media/public-media.repository.js';
import type { StorageProvider } from '../media/storage/storage-provider.js';
import type { SettingsService } from '../settings/settings.service.js';
import type {
  CardRow,
  CatalogFilters,
  PublicCatalogRepository,
  SizeRow,
} from './public-catalog.repository.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicCatalogService {
  /** Active products with at least one active size, paginated (page size from settings). */
  list(query: CatalogQuery): Promise<PublicProductListDto>;
  /** Whole-catalogue search (name, keywords, clothing type); empty result is not an error. */
  search(query: CatalogSearchQuery): Promise<PublicSearchResultDto>;
  /** Inactive, unknown or unsellable products answer 404. */
  detail(idOrSlug: string): Promise<PublicProductDetailDto>;
  clothingTypes(): Promise<PublicClothingTypeDto[]>;
}

export interface PublicCatalogServiceDeps {
  db: Database;
  repository: PublicCatalogRepository;
  storage: StorageProvider;
  settings: SettingsService;
}

/** Availability from the variant's own low-stock threshold (admin-set). Quantities never leave. */
export function availabilityOf(
  size: Pick<SizeRow, 'available' | 'lowStockThreshold'>,
): SizeAvailability {
  if (size.available <= 0) return 'out_of_stock';
  return size.available <= size.lowStockThreshold ? 'low_stock' : 'in_stock';
}

export function createPublicCatalogService(deps: PublicCatalogServiceDeps): PublicCatalogService {
  const { db, repository, storage, settings } = deps;

  function toCard(row: CardRow, media: ReadonlyMap<string, UsableMedia>): PublicProductCardDto {
    const video = row.videoAssetId === null ? undefined : media.get(row.videoAssetId);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      clothingType: { slug: row.clothingTypeSlug, name: row.clothingTypeName },
      priceMinor: int8ToNumber(row.priceMinor),
      currency: row.currency,
      inStock: row.inStock,
      media: video ? toGridMedia(storage, video) : null,
    };
  }

  async function page(
    query: { page: number; pageSize?: number | undefined },
    filters: CatalogFilters,
  ): Promise<PublicProductListDto> {
    const request = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
    const { rows, total } = await repository.listCards(db, filters, request);
    // One batched media lookup for the whole page (no N+1).
    const media = await loadUsableMedia(
      db,
      rows.map((row) => row.videoAssetId),
    );
    return { data: rows.map((row) => toCard(row, media)), meta: toPageMeta(request, total) };
  }

  return {
    async list(query) {
      return page(query, { clothingTypeSlug: query.clothingType, sort: query.sort });
    },

    async search(query) {
      const result = await page(query, { search: query.q, sort: query.sort });
      return {
        ...result,
        query: query.q,
        ...(result.meta.total === 0 && { code: SEARCH_NO_RESULTS }),
      };
    },

    async detail(idOrSlug) {
      const ref = UUID_PATTERN.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug };
      const product = await repository.findProduct(db, ref);
      if (!product) throw notFoundError('Product');
      const [sizes, imageIds, measurements] = await Promise.all([
        repository.sizesFor(db, product.id),
        repository.imageAssetIds(db, product.id),
        product.measurementProfileId === null
          ? Promise.resolve([])
          : repository.profileMeasurements(db, product.measurementProfileId),
      ]);
      const media = await loadUsableMedia(db, [product.videoAssetId, ...imageIds]);
      const video = product.videoAssetId === null ? undefined : media.get(product.videoAssetId);
      const images = imageIds
        .map((id) => media.get(id))
        .filter((m): m is UsableMedia => m?.kind === 'image');

      return {
        ...toCard(product, media),
        description: product.description,
        videos: video?.kind === 'video' ? [toVideo(storage, video)] : [],
        images: images.map((image) => toImage(storage, image)),
        sizes: sizes.map((size) => ({
          sizeCode: size.sizeCode,
          label: size.label,
          availability: availabilityOf(size),
        })),
        blueprint:
          product.measurementProfileId !== null && product.profileCode !== null
            ? {
                required: true,
                profile: {
                  code: product.profileCode,
                  name: product.profileName ?? product.profileCode,
                  measurements,
                },
              }
            : { required: false, profile: null },
      };
    },

    async clothingTypes() {
      return repository.listClothingTypes(db);
    },
  };
}
