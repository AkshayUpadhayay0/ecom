import { MAX_PAGE_SIZE, type PageMeta, type PaginationQuery } from '@urban-ibile/shared';

export interface PageRequest {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Resolves `page` / `pageSize` from a parsed query. `defaultPageSize` comes from the
 * `catalog.page_size` setting; every value is clamped to MAX_PAGE_SIZE.
 */
export function toPageRequest(query: PaginationQuery, defaultPageSize: number): PageRequest {
  const pageSize = Math.min(query.pageSize ?? defaultPageSize, MAX_PAGE_SIZE);
  return { page: query.page, pageSize, offset: (query.page - 1) * pageSize };
}

export function toPageMeta(request: PageRequest, total: number): PageMeta {
  return {
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: Math.ceil(total / request.pageSize),
  };
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}
