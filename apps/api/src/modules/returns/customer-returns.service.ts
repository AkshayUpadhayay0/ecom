import type {
  CreateReturnRequest,
  CustomerReturnDetailDto,
  CustomerReturnSummaryDto,
  ReplyReturnRequest,
} from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { PG_ERROR, isPgErrorCode } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import type { SettingsService } from '../settings/settings.service.js';
import { classifyReturn, type SelectionMode } from './responsibility.js';
import {
  type WorkflowDeps,
  applyTransition,
  isTriggerRejection,
  queueReturnEmail,
  releaseReplacement,
} from './return-workflow.js';
import { REFUND_INFO, toCustomerSummary, toCustomerTimeline } from './returns.dto.js';
import type { ReturnRow } from './returns.repository.js';

const PAID = 'paid';
const DELIVERED = 'delivered';
const PRIVATE = 'private';
const ONE_OPEN_PER_ITEM = 'uq_returns_one_open_per_item';
/** Evidence that finished uploading (verified) may be attached. */
const ATTACHABLE_STATUSES = new Set(['uploaded', 'processing', 'ready']);
/** Statuses where the approval instructions apply. */
const SHOW_INSTRUCTIONS = new Set(['AWAITING_RETURN', 'RETURN_IN_TRANSIT']);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CustomerReturnsService {
  create(
    customerId: string,
    orderId: string,
    itemId: string,
    input: CreateReturnRequest,
  ): Promise<CustomerReturnDetailDto>;
  list(
    customerId: string,
    query: { page: number; pageSize?: number | undefined },
  ): Promise<Page<CustomerReturnSummaryDto>>;
  get(customerId: string, id: string): Promise<CustomerReturnDetailDto>;
  /** Answers "more information requested": the SAME request returns to UNDER_REVIEW. */
  reply(
    customerId: string,
    id: string,
    input: ReplyReturnRequest,
  ): Promise<CustomerReturnDetailDto>;
  cancel(
    customerId: string,
    id: string,
    reason: string | undefined,
  ): Promise<CustomerReturnDetailDto>;
}

export interface CustomerReturnsDeps extends WorkflowDeps {
  db: Database;
  logger: Logger;
  settings: SettingsService;
}

function notAllowed(message: string): AppError {
  return new AppError('RETURN_NOT_ALLOWED', HTTP_STATUS.CONFLICT, message);
}

export function createCustomerReturnsService(deps: CustomerReturnsDeps): CustomerReturnsService {
  const { db, logger, repository, settings } = deps;

  async function detail(executor: Database, row: ReturnRow): Promise<CustomerReturnDetailDto> {
    const [events, media] = await Promise.all([
      repository.events(executor, row.id, 'CUSTOMER'),
      repository.media(executor, row.id),
    ]);
    const instructions = SHOW_INSTRUCTIONS.has(row.status)
      ? {
          address: await settings.getSetting(executor, 'returns.return_address'),
          instructions: await settings.getSetting(executor, 'returns.return_instructions'),
        }
      : null;
    return {
      ...toCustomerSummary(row),
      explanation: row.explanation,
      exchangeSizeLabel: row.exchangeSizeLabel,
      evidence: media.map((m) => ({ id: m.id, mimeType: m.mimeType, status: m.status })),
      returnInstructions: instructions,
      replacement:
        row.requestType === 'EXCHANGE'
          ? {
              sizeLabel: row.exchangeSizeLabel,
              carrier: row.replacementCarrier,
              trackingReference: row.replacementTrackingReference,
              sentAt: row.replacementSentAt?.toISOString() ?? null,
            }
          : null,
      refund: REFUND_INFO,
      timeline: toCustomerTimeline(events),
    };
  }

  /** Own, private, verified, unused uploads only; anything else looks like "not found". */
  async function assertAttachable(
    executor: Database,
    customerId: string,
    ids: readonly string[],
  ): Promise<void> {
    const max = await settings.getLimit(executor, 'returns.evidence_max_files');
    if (ids.length > max) {
      throw new AppError(
        'VALIDATION_ERROR',
        HTTP_STATUS.BAD_REQUEST,
        'Request validation failed.',
        {
          issues: [{ path: 'evidenceMediaIds', message: `At most ${max} photos.` }],
        },
      );
    }
    const assets = await repository.evidenceAssets(executor, ids);
    const usable = assets.filter(
      (a) =>
        a.ownerCustomerId === customerId &&
        a.visibility === PRIVATE &&
        ATTACHABLE_STATUSES.has(a.status) &&
        a.retiredAt === null &&
        !a.attached,
    );
    if (usable.length !== ids.length) throw notFoundError('Media asset');
  }

  async function loadOwned(
    executor: Database,
    customerId: string,
    id: string,
    lock = false,
  ): Promise<ReturnRow> {
    const owned = await repository.findForCustomer(executor, id, customerId);
    if (!owned) throw notFoundError('Return request');
    if (!lock) return owned;
    const locked = await repository.find(executor, id, true);
    if (!locked) throw notFoundError('Return request');
    return locked;
  }

  return {
    async create(customerId, orderId, itemId, input) {
      const evidenceIds = [...new Set(input.evidenceMediaIds)];
      try {
        return await db.transaction().execute(async (trx) => {
          const item = await repository.lockOrderItem(trx, orderId, itemId, customerId);
          if (!item) throw notFoundError('Order item');
          if (item.paymentStatus !== PAID || item.orderStatus !== DELIVERED) {
            throw notAllowed('Returns can be requested for paid, delivered orders only.');
          }
          const reason = await repository.reason(trx, input.reasonCode);
          if (!reason) {
            throw new AppError(
              'VALIDATION_ERROR',
              HTTP_STATUS.BAD_REQUEST,
              'Request validation failed.',
              {
                issues: [{ path: 'reasonCode', message: 'Unknown return reason.' }],
              },
            );
          }
          if (await repository.hasOpenRequest(trx, item.itemId)) {
            throw new AppError(
              'RETURN_ALREADY_OPEN',
              HTTP_STATUS.CONFLICT,
              'There is already an open request for this item.',
            );
          }
          const remaining = item.quantity - (await repository.countedQuantity(trx, item.itemId));
          if (input.quantity > remaining) {
            throw new AppError(
              'QUANTITY_LIMIT_EXCEEDED',
              HTTP_STATUS.CONFLICT,
              `You can return at most ${Math.max(remaining, 0)} of this item.`,
              {
                remaining: Math.max(remaining, 0),
              },
            );
          }

          // Policy: a NULL rule is "not enforced yet" (never a default).
          const policy = await repository.activePolicy(trx);
          if (policy?.requestWindowDays != null && item.deliveredAt !== null) {
            const closesAt = item.deliveredAt.getTime() + policy.requestWindowDays * DAY_MS;
            if (Date.now() > closesAt) {
              throw new AppError(
                'RETURN_WINDOW_CLOSED',
                HTTP_STATUS.CONFLICT,
                'The return window for this order has closed.',
                {
                  windowDays: policy.requestWindowDays,
                },
              );
            }
          }
          const confirmations = input.conditionConfirmations ?? {};
          if (policy?.requireOriginalTags === true && confirmations.originalTags !== true) {
            throw new AppError(
              'RETURN_CONDITION_NOT_MET',
              HTTP_STATUS.CONFLICT,
              'Items must be returned with their original tags.',
              {
                condition: 'originalTags',
              },
            );
          }
          if (policy?.requireUnwornUnwashed === true && confirmations.unwornUnwashed !== true) {
            throw new AppError(
              'RETURN_CONDITION_NOT_MET',
              HTTP_STATUS.CONFLICT,
              'Items must be unworn and unwashed.',
              {
                condition: 'unwornUnwashed',
              },
            );
          }

          if (reason.evidenceRequirement === 'required' && evidenceIds.length === 0) {
            throw new AppError(
              'EVIDENCE_REQUIRED',
              HTTP_STATUS.BAD_REQUEST,
              'Please add at least one photo for this reason.',
            );
          }
          await assertAttachable(trx, customerId, evidenceIds);

          let replacementVariantId: string | null = null;
          if (input.requestType === 'EXCHANGE' && input.exchangeSizeId !== undefined) {
            const variant = await repository.variantForSize(
              trx,
              item.productId,
              input.exchangeSizeId,
            );
            if (!variant?.isActive) {
              throw new AppError(
                'SIZE_NOT_OFFERED',
                HTTP_STATUS.CONFLICT,
                'This product is not made in that size.',
              );
            }
            replacementVariantId = variant.id;
          }

          // The backend decides responsibility (never the client).
          const classification = classifyReturn(
            reason.code,
            item.selectionMode as SelectionMode | null,
          );
          const id = await repository.insert(trx, {
            orderId: item.orderId,
            orderItemId: item.itemId,
            customerId,
            requestType: input.requestType,
            reasonCode: reason.code,
            explanation: input.explanation ?? null,
            quantity: input.quantity,
            exchangeSizeId: input.exchangeSizeId ?? null,
            replacementVariantId,
            policyId: policy?.id ?? null,
            responsibility: classification.responsibility,
            faultCause: classification.faultCause,
            payer: classification.payer,
            faultBasis: classification.basis,
            confirmedOriginalTags: policy?.requireOriginalTags === true ? true : null,
            confirmedUnwornUnwashed: policy?.requireUnwornUnwashed === true ? true : null,
          });
          await repository.attachMedia(trx, id, evidenceIds);
          const submittedEvent = await repository.insertEvent(trx, {
            returnRequestId: id,
            type: 'SUBMITTED',
            fromStatus: null,
            toStatus: 'SUBMITTED',
            actorType: 'CUSTOMER',
            actorId: customerId,
            note: null,
            visibility: 'CUSTOMER',
          });
          await repository.insertEvent(trx, {
            returnRequestId: id,
            type: 'RESPONSIBILITY_SET',
            fromStatus: null,
            toStatus: null,
            actorType: 'SYSTEM',
            actorId: null,
            note: `${classification.responsibility}${classification.faultCause ? ` / ${classification.faultCause}` : ''} (${classification.basis})`,
            visibility: 'INTERNAL',
          });
          const row = await repository.find(trx, id);
          if (!row) throw new Error('Inserted return request not found');
          await queueReturnEmail(trx, deps.outbox, row, submittedEvent, {
            template: 'return_received',
          });
          // Ids only: no explanation, evidence or contact data in logs.
          logger.info(
            {
              returnRequestId: id,
              orderId: item.orderId,
              type: input.requestType,
              responsibility: classification.responsibility,
            },
            'return request created',
          );
          return detail(trx, row);
        });
      } catch (err) {
        if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION, ONE_OPEN_PER_ITEM)) {
          throw new AppError(
            'RETURN_ALREADY_OPEN',
            HTTP_STATUS.CONFLICT,
            'There is already an open request for this item.',
          );
        }
        if (isTriggerRejection(err)) throw notFoundError('Order item');
        throw err;
      }
    },

    async list(customerId, query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.listForCustomer(db, customerId, page);
      return { items: rows.map(toCustomerSummary), meta: toPageMeta(page, total) };
    },

    async get(customerId, id) {
      return detail(db, await loadOwned(db, customerId, id));
    },

    async reply(customerId, id, input) {
      const evidenceIds = [...new Set(input.evidenceMediaIds)];
      return db.transaction().execute(async (trx) => {
        const row = await loadOwned(trx, customerId, id, true);
        await assertAttachable(trx, customerId, evidenceIds);
        const { row: updated } = await applyTransition(trx, deps, row, {
          toStatus: 'UNDER_REVIEW',
          // Only AWAITING_CUSTOMER -> UNDER_REVIEW exists for customers (transitions table).
          expectedStatus: row.status,
          actor: { type: 'CUSTOMER', id: customerId, ipAddress: null },
          eventType: 'CUSTOMER_REPLY',
          note: input.message,
        });
        await repository.attachMedia(trx, id, evidenceIds);
        logger.info(
          { returnRequestId: id, evidence: evidenceIds.length },
          'return request: customer replied',
        );
        return detail(trx, updated);
      });
    },

    async cancel(customerId, id, reason) {
      return db.transaction().execute(async (trx) => {
        const row = await loadOwned(trx, customerId, id, true);
        const { row: updated } = await applyTransition(trx, deps, row, {
          toStatus: 'CANCELLED',
          expectedStatus: row.status,
          actor: { type: 'CUSTOMER', id: customerId, ipAddress: null },
          eventType: 'CANCELLED_BY_CUSTOMER',
          note: reason ?? null,
        });
        await releaseReplacement(trx, deps, row, null, 'return cancelled by customer');
        logger.info({ returnRequestId: id }, 'return request cancelled by customer');
        return detail(trx, updated);
      });
    },
  };
}
