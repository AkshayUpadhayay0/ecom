import { z } from 'zod';
import {
  booleanQuerySchema,
  codeSchema,
  moneyMinorSchema,
  paginationQuerySchema,
  searchQuerySchema,
  sortOrderSchema,
} from './admin-common.js';

const MAX_DELIVERY_DAYS = 365;

const nameSchema = z.string().trim().min(1).max(120);
const daysSchema = z.number().int().min(0).max(MAX_DELIVERY_DAYS);

function daysInOrder(body: {
  estDaysMin?: number | null | undefined;
  estDaysMax?: number | null | undefined;
}): boolean {
  const { estDaysMin, estDaysMax } = body;
  return estDaysMin == null || estDaysMax == null || estDaysMin <= estDaysMax;
}
const DAYS_ORDER = { message: 'estDaysMin must not exceed estDaysMax', path: ['estDaysMax'] };

/**
 * `feeMinor: null` means "fee not supplied yet" (Pending Client Decision). Such a zone cannot be
 * active: the API answers ZONE_FEE_REQUIRED and the database enforces the same rule.
 */
export const createDeliveryZoneSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    feeMinor: moneyMinorSchema.nullable().default(null),
    estDaysMin: daysSchema.nullable().default(null),
    estDaysMax: daysSchema.nullable().default(null),
    isActive: z.boolean().default(false),
    sortOrder: sortOrderSchema.default(0),
  })
  .refine(daysInOrder, DAYS_ORDER);
export type CreateDeliveryZoneRequest = z.infer<typeof createDeliveryZoneSchema>;

/** `code` is immutable. */
export const updateDeliveryZoneSchema = z
  .object({
    name: nameSchema.optional(),
    feeMinor: moneyMinorSchema.nullable().optional(),
    estDaysMin: daysSchema.nullable().optional(),
    estDaysMax: daysSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  })
  .refine(daysInOrder, DAYS_ORDER);
export type UpdateDeliveryZoneRequest = z.infer<typeof updateDeliveryZoneSchema>;

export const listDeliveryZonesQuerySchema = paginationQuerySchema.extend({
  q: searchQuerySchema.optional(),
  isActive: booleanQuerySchema.optional(),
});
export type ListDeliveryZonesQuery = z.infer<typeof listDeliveryZonesQuerySchema>;

export interface DeliveryZoneDto {
  id: string;
  code: string;
  name: string;
  feeMinor: number | null;
  estDaysMin: number | null;
  estDaysMax: number | null;
  isActive: boolean;
  isSampleData: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
