import { z } from 'zod';
import {
  booleanQuerySchema,
  moneyMinorSchema,
  paginationQuerySchema,
  searchKeywordsSchema,
  searchQuerySchema,
  slugSchema,
  sortOrderSchema,
} from './admin-common.js';

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 5000;
/** Upper bound on images attached to one product (technical guard, not a business rule). */
export const MAX_PRODUCT_IMAGES = 20;

const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

function atLeastOneField(body: Record<string, unknown>): boolean {
  return Object.values(body).some((value) => value !== undefined);
}
const AT_LEAST_ONE = { message: 'Provide at least one field to update' };

/*
 * Catalogue data is canonical (9 Oct design): one name / description per record, stored for the
 * default language. There is no admin translation management.
 */

// ---------- Clothing types ----------

export const createClothingTypeSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  searchKeywords: searchKeywordsSchema.default(''),
  sortOrder: sortOrderSchema.default(0),
  isActive: z.boolean().default(true),
});
export type CreateClothingTypeRequest = z.infer<typeof createClothingTypeSchema>;

export const updateClothingTypeSchema = z
  .object({
    slug: slugSchema.optional(),
    name: nameSchema.optional(),
    searchKeywords: searchKeywordsSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateClothingTypeRequest = z.infer<typeof updateClothingTypeSchema>;

export const listClothingTypesQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  isActive: booleanQuerySchema.optional(),
  sort: z.enum(['sortOrder', 'slug']).default('sortOrder'),
});
export type ListClothingTypesQuery = z.infer<typeof listClothingTypesQuerySchema>;

export interface ClothingTypeDto {
  id: string;
  slug: string;
  /** Default-language name (null only if the seed row is missing). */
  name: string | null;
  searchKeywords: string;
  sortOrder: number;
  isActive: boolean;
}

// ---------- Sizes (seeded with the size charts; admin can only list and reorder) ----------

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

// ---------- Products ----------

export const PRODUCT_STATUSES = ['draft', 'active', 'inactive', 'archived'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

const descriptionSchema = z.string().trim().min(1).max(DESCRIPTION_MAX_LENGTH);

export const createProductSchema = z.object({
  /** Never translated. */
  name: nameSchema,
  slug: slugSchema,
  clothingTypeId: z.uuid(),
  description: descriptionSchema,
  priceMinor: moneyMinorSchema,
  /** Which body measurements Blueprint needs. null = product does not use Blueprint. */
  measurementProfileId: z.uuid().nullable().default(null),
  searchKeywords: searchKeywordsSchema.default(''),
  displayOrder: sortOrderSchema.default(0),
  /** New products cannot start archived. */
  status: productStatusSchema.exclude(['archived']).default('draft'),
});
export type CreateProductRequest = z.infer<typeof createProductSchema>;

/** Status changes go through POST /products/:id/status. */
export const updateProductSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    clothingTypeId: z.uuid().optional(),
    description: descriptionSchema.optional(),
    priceMinor: moneyMinorSchema.optional(),
    measurementProfileId: z.uuid().nullable().optional(),
    searchKeywords: searchKeywordsSchema.optional(),
    displayOrder: sortOrderSchema.optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);
export type UpdateProductRequest = z.infer<typeof updateProductSchema>;

export const changeProductStatusSchema = z.object({ status: productStatusSchema });
export type ChangeProductStatusRequest = z.infer<typeof changeProductStatusSchema>;

export const assignMediaSchema = z.object({ mediaAssetId: z.uuid() });
export type AssignMediaRequest = z.infer<typeof assignMediaSchema>;

/** Replaces the product's image list; order of `mediaAssetIds` = display order. */
export const setProductImagesSchema = z.object({
  mediaAssetIds: z
    .array(z.uuid())
    .max(MAX_PRODUCT_IMAGES)
    .refine((ids) => new Set(ids).size === ids.length, 'mediaAssetIds must be unique'),
});
export type SetProductImagesRequest = z.infer<typeof setProductImagesSchema>;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  status: productStatusSchema.optional(),
  clothingTypeId: z.uuid().optional(),
  measurementProfileId: z.uuid().optional(),
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
  measurementProfile: { id: string; code: string; name: string } | null;
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
  description: string | null;
  /** Image media asset ids in display order. */
  imageAssetIds: string[];
}
