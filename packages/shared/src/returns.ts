import { z } from 'zod';
import { paginationQuerySchema } from './admin-common.js';

/*
 * Returns / Exchange / Fault-Line (Phase 7b, 9 Oct design). Responsibility is decided by the
 * backend and is never accepted from a client. No money moves: refunds are not executed.
 */

export const RETURN_REQUEST_TYPES = ['RETURN', 'EXCHANGE'] as const;
export type ReturnRequestType = (typeof RETURN_REQUEST_TYPES)[number];
export const RETURN_RESPONSIBILITIES = [
  'CUSTOMER_FAULT',
  'REVIEW_REQUIRED',
  'BRAND_FAULT',
] as const;
export type ReturnResponsibility = (typeof RETURN_RESPONSIBILITIES)[number];
export const RETURN_PAYERS = ['CUSTOMER', 'BRAND', 'UNDECIDED'] as const;
export type ReturnPayer = (typeof RETURN_PAYERS)[number];
export const INSPECTION_OUTCOMES = ['RESELLABLE', 'NOT_RESELLABLE'] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

const codeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,59}$/, 'must be a code');
const statusSchema = z.string().regex(/^[A-Z][A-Z_]{1,39}$/, 'must be a return status');
const textSchema = (max: number) => z.string().trim().min(1).max(max);
const evidenceIdsSchema = z.array(z.uuid()).max(20);

// ---------- Customer requests ----------

export const createReturnSchema = z
  .object({
    requestType: z.enum(RETURN_REQUEST_TYPES),
    reasonCode: codeSchema,
    explanation: textSchema(2000).optional(),
    quantity: z.number().int().min(1).default(1),
    /** EXCHANGE only: the size of the replacement (must be a size the product is made in). */
    exchangeSizeId: z.uuid().optional(),
    evidenceMediaIds: evidenceIdsSchema.default([]),
    /** Asked only when the active return policy requires the condition. */
    conditionConfirmations: z
      .object({ originalTags: z.boolean().optional(), unwornUnwashed: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => (body.requestType === 'EXCHANGE') === (body.exchangeSizeId !== undefined), {
    message: 'exchangeSizeId is required for EXCHANGE and not allowed for RETURN',
    path: ['exchangeSizeId'],
  });
export type CreateReturnRequest = z.infer<typeof createReturnSchema>;

/** Answer to "more information requested": the SAME request goes back to review. */
export const replyReturnSchema = z
  .object({ message: textSchema(2000), evidenceMediaIds: evidenceIdsSchema.default([]) })
  .strict();
export type ReplyReturnRequest = z.infer<typeof replyReturnSchema>;

export const cancelReturnSchema = z.object({ reason: textSchema(500).optional() }).strict();

export const listMyReturnsQuerySchema = paginationQuerySchema.strict();

// ---------- Admin ----------

export const listAdminReturnsQuerySchema = paginationQuerySchema
  .extend({
    status: statusSchema.optional(),
    requestType: z.enum(RETURN_REQUEST_TYPES).optional(),
    responsibility: z.enum(RETURN_RESPONSIBILITIES).optional(),
    reasonCode: codeSchema.optional(),
    from: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    to: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    /** Request number, order number, customer name, email or phone. */
    q: z.string().trim().min(2).max(100).optional(),
    /** true = not completed / rejected / cancelled. */
    open: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();
export type ListAdminReturnsQuery = z.infer<typeof listAdminReturnsQuerySchema>;

const expected = { expectedStatus: statusSchema };
export const approveReturnSchema = z
  .object({ ...expected, note: textSchema(2000).optional() })
  .strict();
export const rejectReturnSchema = z.object({ ...expected, reason: textSchema(2000) }).strict();
export const requestReturnInfoSchema = z
  .object({ ...expected, message: textSchema(2000) })
  .strict();
export const markReturnReceivedSchema = z
  .object({ ...expected, note: textSchema(2000).optional() })
  .strict();
export const advanceReturnSchema = z
  .object({
    ...expected,
    toStatus: statusSchema,
    note: textSchema(2000).optional(),
    /** EXCHANGE_SENT only. */
    carrier: textSchema(100).optional(),
    trackingReference: textSchema(200).optional(),
  })
  .strict();
export type AdvanceReturnRequest = z.infer<typeof advanceReturnSchema>;
export const inspectReturnSchema = z
  .object({
    outcome: z.enum(INSPECTION_OUTCOMES),
    notes: textSchema(2000).optional(),
    /** RESELLABLE only; defaults to the returned quantity, never more. */
    restockQuantity: z.number().int().min(1).optional(),
  })
  .strict();
export type InspectReturnRequest = z.infer<typeof inspectReturnSchema>;
export const setReturnResponsibilitySchema = z
  .object({
    responsibility: z.enum(RETURN_RESPONSIBILITIES),
    faultCause: codeSchema.nullable(),
    /** Optional override of the default payer for the responsibility. */
    payer: z.enum(RETURN_PAYERS).optional(),
    note: textSchema(2000),
  })
  .strict();
export type SetReturnResponsibilityRequest = z.infer<typeof setReturnResponsibilitySchema>;
export const returnNoteSchema = z.object({ body: textSchema(2000) }).strict();

// ---------- DTOs ----------

/** Money is never moved by this API: refund method and timing are Pending Client Decisions. */
export interface ReturnRefundInfoDto {
  executed: false;
  policy: 'PENDING_CLIENT_DECISION';
}

export interface CustomerReturnTimelineEventDto {
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  message: string | null;
  by: 'you' | 'urban_ibile';
  createdAt: string;
}

export interface CustomerReturnSummaryDto {
  id: string;
  requestNumber: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  requestType: ReturnRequestType;
  reasonCode: string;
  quantity: number;
  status: string;
  statusLabel: string;
  product: { name: string; sizeLabel: string };
  /** Neutral wording; never "fault". */
  returnCosts: { payer: ReturnPayer; label: string };
  submittedAt: string;
  updatedAt: string;
}

export interface CustomerReturnDetailDto extends CustomerReturnSummaryDto {
  explanation: string | null;
  exchangeSizeLabel: string | null;
  /** Evidence ids; view each through GET /me/media/:id/url (short-lived signed URL). */
  evidence: { id: string; mimeType: string; status: string }[];
  /** Placeholders until the client supplies them (shown once approved). */
  returnInstructions: { address: string; instructions: string } | null;
  replacement: {
    sizeLabel: string | null;
    carrier: string | null;
    trackingReference: string | null;
    sentAt: string | null;
  } | null;
  refund: ReturnRefundInfoDto;
  timeline: CustomerReturnTimelineEventDto[];
}

export interface AdminReturnSummaryDto {
  id: string;
  requestNumber: string;
  status: string;
  requestType: ReturnRequestType;
  reasonCode: string;
  quantity: number;
  responsibility: ReturnResponsibility;
  faultCause: string | null;
  payer: ReturnPayer;
  order: { id: string; orderNumber: string };
  customer: { id: string; fullName: string; email: string };
  product: { name: string; sku: string; sizeLabel: string };
  submittedAt: string;
  updatedAt: string;
}

export interface AdminReturnEvidenceDto {
  id: string;
  mimeType: string;
  status: string;
  /** Short-lived signed URL (private bucket); null while the file is not stored yet. */
  url: string | null;
  expiresAt: string | null;
}

export interface AdminReturnEventDto {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  visibility: 'CUSTOMER' | 'INTERNAL';
  note: string | null;
  actor: { type: 'CUSTOMER' | 'ADMIN' | 'SYSTEM'; id: string | null; name: string | null };
  createdAt: string;
}

export interface AdminReturnDetailDto extends AdminReturnSummaryDto {
  explanation: string | null;
  policy: {
    id: string;
    version: number;
    name: string;
    requestWindowDays: number | null;
    requireOriginalTags: boolean | null;
    requireUnwornUnwashed: boolean | null;
  } | null;
  conditionConfirmations: { originalTags: boolean | null; unwornUnwashed: boolean | null };
  item: {
    orderItemId: string;
    productId: string;
    variantId: string;
    productName: string;
    sku: string;
    sizeLabel: string;
    purchasedQuantity: number;
    unitPriceMinor: number;
  };
  orderDetails: {
    status: string;
    paymentStatus: string;
    deliveredAt: string | null;
    currency: string;
  };
  blueprint: {
    decisionId: string;
    method: string;
    selectionMode: string;
    fitPreference: string;
    recommendedSize: string;
    selectedSize: string;
    charts: { group: string; version: number }[];
    measurements: { code: string; label: string; valueInches: number; requiredSize: string }[];
  } | null;
  responsibilityDetails: { setBy: 'SYSTEM' | 'ADMIN'; setAt: string | null; basis: string | null };
  adminDecision: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  exchange: {
    sizeId: string | null;
    sizeLabel: string | null;
    replacementVariantId: string | null;
    replacementSku: string | null;
    reservationStatus: string | null;
    carrier: string | null;
    trackingReference: string | null;
    sentAt: string | null;
  } | null;
  inspection: {
    outcome: InspectionOutcome;
    notes: string | null;
    inspectedAt: string;
    inspectedBy: { id: string; name: string };
    restockedQuantity: number;
  } | null;
  evidence: AdminReturnEvidenceDto[];
  timeline: AdminReturnEventDto[];
  allowedTransitions: { toStatus: string; requiresReason: boolean; requiresInspection: boolean }[];
  refund: ReturnRefundInfoDto;
  closedAt: string | null;
}
