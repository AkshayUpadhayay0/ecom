import { z } from 'zod';
import {
  booleanQuerySchema,
  codeSchema,
  languageCodeSchema,
  moneyMinorSchema,
  paginationQuerySchema,
  searchKeywordsSchema,
  searchQuerySchema,
  slugSchema,
  sortOrderSchema,
  type Translations,
} from './admin-common.js';

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 5000;
const NOTES_MAX_LENGTH = 2000;

const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

/**
 * Translation maps. On create, the default language (English) is required; on update, a
 * language set to `null` removes that translation (never allowed for the default language).
 */
function translationsSchema<T extends z.ZodType>(entry: T) {
  return z.record(languageCodeSchema, entry);
}
function translationsPatchSchema<T extends z.ZodType>(entry: T) {
  return z.record(languageCodeSchema, entry.nullable());
}

function atLeastOneField(body: Record<string, unknown>): boolean {
  return Object.values(body).some((value) => value !== undefined);
}
const AT_LEAST_ONE = { message: 'Provide at least one field to update' };

// ---------- Clothing types ----------

const clothingTypeTranslationSchema = z.object({ name: nameSchema });

export const createClothingTypeSchema = z.object({
  slug: slugSchema,
  searchKeywords: searchKeywordsSchema.default(''),
  sortOrder: sortOrderSchema.default(0),
  isActive: z.boolean().default(true),
  translations: translationsSchema(clothingTypeTranslationSchema),
});
export type CreateClothingTypeRequest = z.infer<typeof createClothingTypeSchema>;

export const updateClothingTypeSchema = z
  .object({
    slug: slugSchema.optional(),
    searchKeywords: searchKeywordsSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    isActive: z.boolean().optional(),
    translations: translationsPatchSchema(clothingTypeTranslationSchema).optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateClothingTypeRequest = z.infer<typeof updateClothingTypeSchema>;

export const listClothingTypesQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  isActive: booleanQuerySchema.optional(),
  sort: z.enum(['sortOrder', 'slug', 'createdAt']).default('sortOrder'),
});
export type ListClothingTypesQuery = z.infer<typeof listClothingTypesQuerySchema>;

export interface ClothingTypeDto {
  id: string;
  slug: string;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
  translations: Translations<{ name: string }>;
}

// ---------- Sizes ----------

export const createSizeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'must be uppercase letters/digits (S, M, XL, 42)'),
  label: nameSchema,
  sortOrder: sortOrderSchema.optional(),
  isActive: z.boolean().default(true),
});
export type CreateSizeRequest = z.infer<typeof createSizeSchema>;

/** `code` is immutable (Blueprint seeds and stock lists refer to it). */
export const updateSizeSchema = z
  .object({
    label: nameSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateSizeRequest = z.infer<typeof updateSizeSchema>;

/** Every size id exactly once, in the new display order. */
export const reorderSizesSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'ids must be unique'),
});
export type ReorderSizesRequest = z.infer<typeof reorderSizesSchema>;

export const listSizesQuerySchema = paginationQuerySchema.extend({
  isActive: booleanQuerySchema.optional(),
});
export type ListSizesQuery = z.infer<typeof listSizesQuerySchema>;

export interface SizeDto {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

// ---------- Garment cuts ----------

const notesSchema = z.string().trim().max(NOTES_MAX_LENGTH);

export const createGarmentCutSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  notes: notesSchema.nullable().default(null),
  isActive: z.boolean().default(true),
});
export type CreateGarmentCutRequest = z.infer<typeof createGarmentCutSchema>;

/** `code` is immutable (Blueprint rule sets are scoped to a cut). */
export const updateGarmentCutSchema = z
  .object({
    name: nameSchema.optional(),
    notes: notesSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateGarmentCutRequest = z.infer<typeof updateGarmentCutSchema>;

export const listGarmentCutsQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  isActive: booleanQuerySchema.optional(),
});
export type ListGarmentCutsQuery = z.infer<typeof listGarmentCutsQuerySchema>;

export interface GarmentCutDto {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Products ----------

export const PRODUCT_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

const productTranslationSchema = z.object({
  description: z.string().trim().min(1).max(DESCRIPTION_MAX_LENGTH),
});

export const createProductSchema = z.object({
  /** Never translated. */
  name: nameSchema,
  slug: slugSchema,
  clothingTypeId: z.uuid(),
  garmentCutId: z.uuid().nullable().default(null),
  priceMinor: moneyMinorSchema,
  searchKeywords: searchKeywordsSchema.default(''),
  displayOrder: sortOrderSchema.default(0),
  /** New products cannot start archived. */
  status: productStatusSchema.exclude(['archived']).default('draft'),
  translations: translationsSchema(productTranslationSchema),
});
export type CreateProductRequest = z.infer<typeof createProductSchema>;

/** Status changes go through POST /products/:id/status. */
export const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    clothingTypeId: z.uuid().optional(),
    garmentCutId: z.uuid().nullable().optional(),
    priceMinor: moneyMinorSchema.optional(),
    searchKeywords: searchKeywordsSchema.optional(),
    displayOrder: sortOrderSchema.optional(),
    translations: translationsPatchSchema(productTranslationSchema).optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateProductRequest = z.infer<typeof updateProductSchema>;

export const changeProductStatusSchema = z.object({ status: productStatusSchema });
export type ChangeProductStatusRequest = z.infer<typeof changeProductStatusSchema>;

export const assignMediaSchema = z.object({ mediaAssetId: z.uuid() });
export type AssignMediaRequest = z.infer<typeof assignMediaSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  status: productStatusSchema.optional(),
  clothingTypeId: z.uuid().optional(),
  garmentCutId: z.uuid().optional(),
  sort: z
    .enum(['displayOrder', 'name', 'priceMinor', 'createdAt', 'updatedAt'])
    .default('displayOrder'),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export interface ProductSummaryDto {
  id: string;
  slug: string;
  name: string;
  clothingType: { id: string; slug: string; name: string | null };
  garmentCut: { id: string; code: string; name: string } | null;
  priceMinor: number;
  currency: string;
  status: ProductStatus;
  displayOrder: number;
  searchKeywords: string;
  videoAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDto extends ProductSummaryDto {
  translations: Translations<{ description: string }>;
}
