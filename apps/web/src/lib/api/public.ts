import type {
  CatalogSort,
  PublicClothingTypeDto,
  PublicContentBlockDto,
  PublicProductDetailDto,
  PublicProductListDto,
  PublicSearchResultDto,
  PublicSiteConfigDto,
} from '@urban-ibile/shared';
import { CATALOG_REVALIDATE_SECONDS } from '@/config/constants';
import { ApiError, apiGet } from './client';

/** Search with free text is never cached: arbitrary queries would only fill the data cache. */
const SEARCH_REVALIDATE_SECONDS = 0;

export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: CatalogSort;
  clothingType?: string;
}

export async function getSiteConfig(): Promise<PublicSiteConfigDto> {
  const body = await apiGet<{ data: PublicSiteConfigDto }>('/site/config', {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return body.data;
}

/** Footer / policy text block. Unknown or unpublished keys come back as null, not as an error. */
export async function getContentBlock(key: string): Promise<PublicContentBlockDto | null> {
  try {
    const body = await apiGet<{ data: PublicContentBlockDto }>(`/site/content/${encodeURIComponent(key)}`, {
      revalidate: CATALOG_REVALIDATE_SECONDS,
    });
    return body.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function getProducts(params: ListParams): Promise<PublicProductListDto> {
  return apiGet<PublicProductListDto>('/catalog/products', {
    revalidate: CATALOG_REVALIDATE_SECONDS,
    query: { ...params },
  });
}

export function searchProducts(q: string, params: ListParams): Promise<PublicSearchResultDto> {
  return apiGet<PublicSearchResultDto>('/catalog/search', {
    revalidate: SEARCH_REVALIDATE_SECONDS,
    query: { q, page: params.page, pageSize: params.pageSize, sort: params.sort },
  });
}

export async function getClothingTypes(): Promise<PublicClothingTypeDto[]> {
  const body = await apiGet<{ data: PublicClothingTypeDto[] }>('/catalog/clothing-types', {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return body.data;
}

/** null when the product is unknown, inactive or unsellable (API answers 404). */
export async function getProduct(slug: string): Promise<PublicProductDetailDto | null> {
  try {
    const body = await apiGet<{ data: PublicProductDetailDto }>(`/catalog/products/${encodeURIComponent(slug)}`, {
      revalidate: CATALOG_REVALIDATE_SECONDS,
    });
    return body.data;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

/** Page size the catalogue uses (setting catalog.page_size); never hard-coded in the UI. */
export function pageSizeFrom(config: PublicSiteConfigDto): number | undefined {
  const value = config.settings['catalog.page_size'];
  return typeof value === 'number' && value > 0 ? value : undefined;
}
