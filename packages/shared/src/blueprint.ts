import { z } from 'zod';
import { MAX_PAGE_SIZE } from './admin-common.js';
import type { SizeAvailability } from './storefront.js';

/*
 * Blueprint (virtual fitting room). Input is body measurements in INCHES; weight and height are
 * not inputs. Measurement codes, fit options and sizes come from the database, never from code.
 */

export const MEASUREMENT_METHODS = ['MANUAL_MEASUREMENTS', 'BODY_SCAN'] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];
export const SELECTION_MODES = ['LOCKED_RECOMMENDATION', 'OVERRIDE'] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];
export const MEASUREMENT_UNIT = 'in';
/** Matching rule recorded with every chart (only rule defined so far). */
export const BOUNDARY_RULE = 'SMALLEST_COVERING_SIZE';

const codeKey = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a measurement code');

/** Shared by preview and decision: either typed measurements or a completed Body Scan. */
const fittingInput = {
  productId: z.uuid(),
  method: z.enum(MEASUREMENT_METHODS),
  /** Inches, keyed by measurement code. Required for MANUAL_MEASUREMENTS. */
  measurements: z.record(codeKey, z.number()).optional(),
  bodyScanSessionId: z.uuid().optional(),
  fitPreference: z.string().trim().min(1).max(40),
};

function checkMethodInputs(
  body: { method: MeasurementMethod; measurements?: unknown; bodyScanSessionId?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (body.method === 'MANUAL_MEASUREMENTS' && body.measurements === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['measurements'],
      message: 'Required for MANUAL_MEASUREMENTS',
    });
  }
  if (body.method === 'MANUAL_MEASUREMENTS' && body.bodyScanSessionId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['bodyScanSessionId'], message: 'Only for BODY_SCAN' });
  }
  if (body.method === 'BODY_SCAN' && body.bodyScanSessionId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['bodyScanSessionId'],
      message: 'Required for BODY_SCAN',
    });
  }
  if (body.method === 'BODY_SCAN' && body.measurements !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['measurements'],
      message: 'Body Scan provides the measurements',
    });
  }
}

export const recommendationRequestSchema = z.object(fittingInput).superRefine(checkMethodInputs);
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;

export const decisionRequestSchema = z
  .object({
    ...fittingInput,
    selectionMode: z.enum(SELECTION_MODES),
    /** Required for OVERRIDE; for LOCKED_RECOMMENDATION it must equal the recommendation. */
    chosenSizeId: z.uuid().optional(),
  })
  .superRefine(checkMethodInputs);
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export const listDecisionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  productId: z.uuid().optional(),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;

export const createBodyScanSessionSchema = z.object({ productId: z.uuid() });

export interface SizeRefDto {
  id: string;
  code: string;
  label: string;
}

export interface FitOptionDto {
  code: string;
  label: string;
}

export interface MeasurementRequirementDto {
  code: string;
  label: string;
  helpText: string | null;
  unit: typeof MEASUREMENT_UNIT;
  /** Sane input range (settings; sample values until the tailor confirms). */
  minInches: number;
  maxInches: number;
}

export interface BlueprintRequirementsDto {
  productId: string;
  required: boolean;
  profile: { code: string; name: string } | null;
  measurements: MeasurementRequirementDto[];
  unit: typeof MEASUREMENT_UNIT;
  fitOptions: FitOptionDto[];
  bodyScan: { available: boolean; mocked: boolean };
}

export interface MeasurementBreakdownDto {
  code: string;
  label: string;
  valueInches: number;
  chart: { id: string; group: string; version: number };
  requiredSize: SizeRefDto;
}

export interface SizeAlternativeDto extends SizeRefDto {
  availability: SizeAvailability;
}

export interface RecommendationDto {
  productId: string;
  method: MeasurementMethod;
  fitPreference: string;
  recommendedSize: SizeRefDto;
  /** The product is made in the recommended size (an active variant exists). */
  recommendedOffered: boolean;
  /** Something can be bought in that size right now. Nothing is reserved here. */
  recommendedInStock: boolean;
  breakdown: MeasurementBreakdownDto[];
  /** Every size the product is offered in, with availability (for an override). */
  alternatives: SizeAlternativeDto[];
  boundaryRule: string;
  /** true when the measurements came from the MOCK Body Scan provider. */
  mocked: boolean;
}

export interface DecisionDto {
  id: string;
  product: { id: string; slug: string; name: string };
  method: MeasurementMethod;
  fitPreference: string;
  selectionMode: SelectionMode;
  recommendedSize: SizeRefDto;
  selectedSize: SizeRefDto;
  measurements: MeasurementBreakdownDto[];
  bodyScanSessionId: string | null;
  /** Charts and rule used at decision time (decisions are never recalculated). */
  chartSnapshot: unknown;
  createdAt: string;
}

export const BODY_SCAN_STATUSES = ['CREATED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] as const;
export type BodyScanStatus = (typeof BODY_SCAN_STATUSES)[number];

export interface BodyScanSessionDto {
  id: string;
  productId: string;
  status: BodyScanStatus;
  provider: string | null;
  /** MOCK provider: results are fixed sample values, not a real scan. */
  mocked: boolean;
  /** Where the app opens the provider's capture flow (null for the MOCK provider). */
  captureUrl: string | null;
  /** Inches by measurement code, once COMPLETED. No images are ever stored. */
  measurements: Record<string, number> | null;
  failureReason: string | null;
  expiresAt: string | null;
  completedAt: string | null;
}
