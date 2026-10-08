import { z } from 'zod';

/** Upper bound for every paginated list (the default page size is the `catalog.page_size` setting). */
export const MAX_PAGE_SIZE = 50;

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

const SLUG_MAX_LENGTH = 100;
const CODE_MAX_LENGTH = 40;
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/** Query params shared by every admin list: `page`, `pageSize` (1..50), `order`. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  order: z.enum(SORT_ORDERS).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `?isActive=true|false` */
export const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Free-text search box (`?q=`). Empty strings are treated as "no filter". */
export const searchQuerySchema = z
  .string()
  .trim()
  .max(100)
  .transform((value) => (value === '' ? undefined : value));

/** URL slug: lowercase words separated by single hyphens (`linen-shirt`). */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters/digits separated by hyphens');

/** Stable machine code (`lagos-mainland`, `slim_fit`). */
export const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(CODE_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'must be lowercase letters/digits, - or _');

export const languageCodeSchema = z
  .string()
  .regex(LANGUAGE_CODE_PATTERN, 'must be a language code such as en or pcm');

export const sortOrderSchema = z.number().int().min(0).max(1_000_000);

/** Money in minor units (kobo). Integers only; never floats. */
export const moneyMinorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Search synonyms typed by admins (`pants trousers slacks`). */
export const searchKeywordsSchema = z.string().trim().max(500);

/** Translations keyed by language code: `{ en: {...}, pcm: {...} }`. */
export type Translations<T> = Record<string, T>;
