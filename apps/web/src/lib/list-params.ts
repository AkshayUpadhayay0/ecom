import { CATALOG_SORTS, type CatalogSort } from '@urban-ibile/shared';
import { SEARCH_MAX_LENGTH } from '@/config/constants';

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_SORT: CatalogSort = 'newest';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Pages beyond this are treated as page 1 (guards against absurd numbers in the URL). */
const MAX_PAGE_NUMBER = 100_000;

export interface ListState {
  page: number;
  sort: CatalogSort;
  /** Clothing type slug. */
  type: string | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads ?page, ?sort and ?type, ignoring anything invalid instead of failing the page. */
export function parseListState(params: RawSearchParams): ListState {
  const page = Number(first(params.page));
  const sort = first(params.sort);
  const type = first(params.type)?.trim().toLowerCase();
  return {
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE_NUMBER ? page : 1,
    sort: CATALOG_SORTS.find((s) => s === sort) ?? DEFAULT_SORT,
    type: type && SLUG_PATTERN.test(type) ? type : undefined,
  };
}

/** Search text from the URL or the input: trimmed, whitespace collapsed, length limited. */
export function normalizeQuery(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

export function parseSearchQuery(params: RawSearchParams): string {
  return normalizeQuery(first(params.q));
}

export interface HrefState extends Partial<ListState> {
  q?: string | undefined;
}

/** Builds a list URL that keeps only non-default values so URLs stay short and canonical. */
export function listHref(basePath: string, state: HrefState): string {
  const search = new URLSearchParams();
  if (state.q) search.set('q', state.q);
  if (state.type) search.set('type', state.type);
  if (state.sort && state.sort !== DEFAULT_SORT) search.set('sort', state.sort);
  if (state.page && state.page > 1) search.set('page', String(state.page));
  const text = search.toString();
  return text ? `${basePath}?${text}` : basePath;
}
