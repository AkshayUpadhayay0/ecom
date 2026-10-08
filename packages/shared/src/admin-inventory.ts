import { z } from 'zod';
import { booleanQuerySchema, paginationQuerySchema } from './admin-common.js';

/** Technical guard against typos (stock columns are 32-bit integers). Not a business limit. */
export const MAX_STOCK_QUANTITY = 1_000_000;

const SKU_MAX_LENGTH = 64;
const NOTE_MAX_LENGTH = 500;

const skuSchema = z
  .string()
  .trim()
  .min(1)
  .max(SKU_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be letters, digits, ".", "_" or "-"');
const thresholdSchema = z.number().int().min(0).max(MAX_STOCK_QUANTITY);
const onHandSchema = z.number().int().min(0).max(MAX_STOCK_QUANTITY);
const noteSchema = z.string().trim().min(1).max(NOTE_MAX_LENGTH);

// ---------- Variants ----------

export const createVariantSchema = z.object({
  sizeId: z.uuid(),
  sku: skuSchema,
  lowStockThreshold: thresholdSchema.optional(),
  isActive: z.boolean().default(true),
});
export type CreateVariantRequest = z.infer<typeof createVariantSchema>;

/** Stock is never edited here: use stock adjustments. */
export const updateVariantSchema = z
  .object({
    sku: skuSchema.optional(),
    lowStockThreshold: thresholdSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateVariantRequest = z.infer<typeof updateVariantSchema>;

export const listVariantsQuerySchema = paginationQuerySchema.extend({
  isActive: booleanQuerySchema.optional(),
});
export type ListVariantsQuery = z.infer<typeof listVariantsQuerySchema>;

export interface VariantDto {
  id: string;
  productId: string;
  size: { id: string; code: string; label: string };
  sku: string;
  stockOnHand: number;
  stockReserved: number;
  stockAvailable: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LowStockVariantDto extends VariantDto {
  product: { id: string; name: string; slug: string; status: string };
}

// ---------- Stock adjustments ----------

export const STOCK_ADJUSTMENT_TYPES = ['restock', 'adjustment', 'initial'] as const;
export type StockAdjustmentType = (typeof STOCK_ADJUSTMENT_TYPES)[number];

/**
 * - `restock`: add `quantity` (> 0) units.
 * - `initial`: set the first count with `newOnHand` (only before any stock movement exists).
 * - `adjustment`: correction, either a signed `quantity` delta or an absolute `newOnHand`; a
 *   note explaining why is required.
 */
export const stockAdjustmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('restock'),
    quantity: z.number().int().min(1).max(MAX_STOCK_QUANTITY),
    note: noteSchema.optional(),
  }),
  z.object({
    type: z.literal('initial'),
    newOnHand: onHandSchema,
    note: noteSchema.optional(),
  }),
  z
    .object({
      type: z.literal('adjustment'),
      quantity: z
        .number()
        .int()
        .min(-MAX_STOCK_QUANTITY)
        .max(MAX_STOCK_QUANTITY)
        .refine((value) => value !== 0, 'must not be 0')
        .optional(),
      newOnHand: onHandSchema.optional(),
      note: noteSchema,
    })
    .refine((body) => (body.quantity === undefined) !== (body.newOnHand === undefined), {
      message: 'Provide exactly one of quantity or newOnHand',
    }),
]);
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentSchema>;

export const STOCK_MOVEMENT_TYPES = [
  'initial',
  'restock',
  'adjustment',
  'sale',
  'return',
  'reservation',
  'reservation_release',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export interface StockMovementDto {
  id: string;
  variantId: string;
  type: StockMovementType;
  quantityDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  admin: { id: string; displayName: string } | null;
  createdAt: string;
}

export interface StockAdjustmentResultDto {
  variant: VariantDto;
  movement: StockMovementDto;
}

export const listStockMovementsQuerySchema = paginationQuerySchema;
export const listLowStockQuerySchema = paginationQuerySchema;
