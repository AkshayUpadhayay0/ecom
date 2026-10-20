import { z } from 'zod';
import type {
  AdminReturnDetailDto,
  AdminReturnSummaryDto,
  AdvanceReturnRequest,
  InspectReturnRequest,
  InspectionOutcome,
  ListAdminReturnsQuery,
  SetReturnResponsibilityRequest,
} from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import type { AuditActor } from '../audit/audit-actor.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { StorageProvider } from '../media/storage/storage-provider.js';
import type { AdminOrdersRepository } from '../orders/admin-orders.repository.js';
import { storeDateRange } from '../../lib/store-dates.js';
import type { SettingsService } from '../settings/settings.service.js';
import { DEFAULT_PAYER, checkResponsibilityChange, type SelectionMode } from './responsibility.js';
import {
  type ReturnActor,
  type WorkflowDeps,
  applyTransition,
  commitReplacement,
  isTriggerRejection,
  releaseReplacement,
  reserveReplacement,
  statusConflict,
} from './return-workflow.js';
import { REFUND_INFO, toAdminSummary } from './returns.dto.js';
import type { ReturnRow } from './returns.repository.js';

const MS_PER_SECOND = 1000;
const RETURN_RECEIVED = 'RETURN_RECEIVED';
const EXCHANGE_SENT = 'EXCHANGE_SENT';
const STORED = new Set(['uploaded', 'processing', 'ready']);
/** Targets with their own endpoint (approve / reject / request-info / mark-received / cancel). */
const DEDICATED_TARGETS = new Set([
  'APPROVED',
  'AWAITING_RETURN',
  'REJECTED',
  'AWAITING_CUSTOMER',
  RETURN_RECEIVED,
  'CANCELLED',
]);

const chartsSchema = z.object({
  charts: z.array(z.object({ group: z.string(), version: z.number() })),
});

export interface AdminReturnsService {
  list(query: ListAdminReturnsQuery): Promise<Page<AdminReturnSummaryDto>>;
  get(id: string): Promise<AdminReturnDetailDto>;
  approve(
    actor: AuditActor,
    id: string,
    input: { expectedStatus: string; note?: string | undefined },
  ): Promise<AdminReturnDetailDto>;
  reject(
    actor: AuditActor,
    id: string,
    input: { expectedStatus: string; reason: string },
  ): Promise<AdminReturnDetailDto>;
  requestInfo(
    actor: AuditActor,
    id: string,
    input: { expectedStatus: string; message: string },
  ): Promise<AdminReturnDetailDto>;
  markReceived(
    actor: AuditActor,
    id: string,
    input: { expectedStatus: string; note?: string | undefined },
  ): Promise<AdminReturnDetailDto>;
  advance(
    actor: AuditActor,
    id: string,
    input: AdvanceReturnRequest,
  ): Promise<AdminReturnDetailDto>;
  inspect(
    actor: AuditActor,
    id: string,
    input: InspectReturnRequest,
  ): Promise<AdminReturnDetailDto>;
  /** Any admin (note required, audited): any change of responsibility / cause / payer. */
  setResponsibility(
    actor: AuditActor,
    id: string,
    input: SetReturnResponsibilityRequest,
  ): Promise<AdminReturnDetailDto>;
  addNote(actor: AuditActor, id: string, body: string): Promise<AdminReturnDetailDto>;
}

export interface AdminReturnsDeps extends WorkflowDeps {
  db: Database;
  logger: Logger;
  settings: SettingsService;
  storage: StorageProvider;
  orderReads: Pick<AdminOrdersRepository, 'measurements'>;
}

export function createAdminReturnsService(deps: AdminReturnsDeps): AdminReturnsService {
  const { db, logger, repository, stock, settings, storage } = deps;
  const adminActor = (actor: AuditActor): ReturnActor => ({
    type: 'ADMIN',
    id: actor.adminId,
    ipAddress: actor.ipAddress,
  });

  async function detail(executor: Database, row: ReturnRow): Promise<AdminReturnDetailDto> {
    const [events, media, policy, decision, holds, restocked, transitions, ttl] = await Promise.all(
      [
        repository.events(executor, row.id),
        repository.media(executor, row.id),
        row.policyId === null ? undefined : repository.policy(executor, row.policyId),
        row.blueprintDecisionId === null
          ? undefined
          : repository.decision(executor, row.blueprintDecisionId),
        stock.holds(executor, row.id),
        stock.restockedQuantity(executor, row.id),
        repository.transitionsFrom(executor, row.status, 'ADMIN', row.requestType),
        settings.getLimit(executor, 'media.private_url_ttl_seconds'),
      ],
    );
    const measurements = decision
      ? await deps.orderReads.measurements(executor, [decision.id])
      : [];
    const charts = decision ? chartsSchema.safeParse(decision.chartSnapshot) : undefined;
    const expiresAt = new Date(Date.now() + ttl * MS_PER_SECOND).toISOString();
    const evidence = await Promise.all(
      media.map(async (m) => {
        const stored = STORED.has(m.status) && m.purgedAt === null;
        return {
          id: m.id,
          mimeType: m.mimeType,
          status: m.status,
          // Private bucket only: a short-lived signed URL, never a public one.
          url: stored ? await storage.createPrivateSignedUrl(m.originalKey, ttl) : null,
          expiresAt: stored ? expiresAt : null,
        };
      }),
    );
    return {
      ...toAdminSummary(row),
      explanation: row.explanation,
      policy: policy ?? null,
      conditionConfirmations: {
        originalTags: row.confirmedOriginalTags,
        unwornUnwashed: row.confirmedUnwornUnwashed,
      },
      item: {
        orderItemId: row.orderItemId,
        productId: row.productId,
        variantId: row.variantId,
        productName: row.productName,
        sku: row.sku,
        sizeLabel: row.sizeLabel,
        purchasedQuantity: row.purchasedQuantity,
        unitPriceMinor: int8ToNumber(row.unitPriceMinor),
      },
      orderDetails: {
        status: row.orderStatus,
        paymentStatus: row.orderPaymentStatus,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        currency: row.orderCurrency.trim(),
      },
      blueprint: decision
        ? {
            decisionId: decision.id,
            method: decision.method,
            selectionMode: decision.selectionMode,
            fitPreference: decision.fitPreference,
            recommendedSize: decision.recommendedSize,
            selectedSize: decision.selectedSize,
            charts: charts?.success ? charts.data.charts : [],
            measurements: measurements.map((m) => ({
              code: m.code,
              label: m.label,
              valueInches: Number(m.valueInches),
              requiredSize: m.requiredSize,
            })),
          }
        : null,
      responsibilityDetails: {
        setBy: row.responsibilitySetBy as 'SYSTEM' | 'ADMIN',
        setAt: row.responsibilitySetAt?.toISOString() ?? null,
        basis: row.faultBasis,
      },
      adminDecision: row.adminDecision as 'PENDING' | 'APPROVED' | 'REJECTED',
      reviewedBy:
        row.reviewedBy === null ? null : { id: row.reviewedBy, name: row.reviewedByName ?? '' },
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      exchange:
        row.requestType === 'EXCHANGE'
          ? {
              sizeId: row.exchangeSizeId,
              sizeLabel: row.exchangeSizeLabel,
              replacementVariantId: row.replacementVariantId,
              replacementSku: row.replacementSku,
              reservationStatus: holds.at(-1)?.status ?? null,
              carrier: row.replacementCarrier,
              trackingReference: row.replacementTrackingReference,
              sentAt: row.replacementSentAt?.toISOString() ?? null,
            }
          : null,
      inspection:
        row.inspectionOutcome !== null && row.inspectedAt !== null && row.inspectedBy !== null
          ? {
              outcome: row.inspectionOutcome as InspectionOutcome,
              notes: row.inspectionNotes,
              inspectedAt: row.inspectedAt.toISOString(),
              inspectedBy: { id: row.inspectedBy, name: row.inspectedByName ?? '' },
              restockedQuantity: restocked,
            }
          : null,
      evidence,
      timeline: events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        visibility: e.visibility,
        note: e.note,
        actor: { type: e.actorType, id: e.actorId, name: e.actorName },
        createdAt: e.createdAt.toISOString(),
      })),
      allowedTransitions: transitions.map((t) => ({
        toStatus: t.toStatus,
        requiresReason: t.requiresReason,
        requiresInspection: t.requiresInspection,
      })),
      refund: REFUND_INFO,
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  /** Runs `change` in one transaction with the request row locked. */
  async function withLocked(
    id: string,
    change: (trx: Database, row: ReturnRow) => Promise<ReturnRow>,
  ): Promise<AdminReturnDetailDto> {
    return db.transaction().execute(async (trx) => {
      const row = await repository.find(trx, id, true);
      if (!row) throw notFoundError('Return request');
      return detail(trx, await change(trx, row));
    });
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.listAdmin(
        db,
        {
          status: query.status,
          requestType: query.requestType,
          responsibility: query.responsibility,
          reasonCode: query.reasonCode,
          ...storeDateRange(query.from, query.to, await settings.getSetting(db, 'store.timezone')),
          q: query.q,
          open: query.open,
          order: query.order ?? 'desc',
        },
        page,
      );
      return { items: rows.map(toAdminSummary), meta: toPageMeta(page, total) };
    },

    async get(id) {
      const row = await repository.find(db, id);
      if (!row) throw notFoundError('Return request');
      return detail(db, row);
    },

    async approve(actor, id, input) {
      return withLocked(id, async (trx, row) => {
        // If the replacement cannot be reserved, the whole transaction rolls back: not approved.
        const approved = await applyTransition(trx, deps, row, {
          toStatus: 'APPROVED',
          expectedStatus: input.expectedStatus,
          actor: adminActor(actor),
          eventType: 'APPROVED',
          note: input.note ?? null,
          values: {
            admin_decision: 'APPROVED',
            reviewed_by: actor.adminId,
            reviewed_at: new Date(),
          },
        });
        await reserveReplacement(trx, deps, approved.row, actor.adminId);
        const [address, instructions] = await Promise.all([
          settings.getSetting(trx, 'returns.return_address'),
          settings.getSetting(trx, 'returns.return_instructions'),
        ]);
        const awaiting = await applyTransition(trx, deps, approved.row, {
          toStatus: 'AWAITING_RETURN',
          expectedStatus: 'APPROVED',
          actor: adminActor(actor),
          email: {
            template: 'return_approved',
            payload: { returnAddress: address, returnInstructions: instructions },
          },
        });
        logger.info({ returnRequestId: id, adminId: actor.adminId }, 'return request approved');
        return awaiting.row;
      });
    },

    async reject(actor, id, input) {
      return withLocked(id, async (trx, row) => {
        const result = await applyTransition(trx, deps, row, {
          toStatus: 'REJECTED',
          expectedStatus: input.expectedStatus,
          actor: adminActor(actor),
          eventType: 'REJECTED',
          note: input.reason,
          values: {
            admin_decision: 'REJECTED',
            reviewed_by: actor.adminId,
            reviewed_at: new Date(),
          },
          email: { template: 'return_rejected', payload: { message: input.reason } },
        });
        await releaseReplacement(trx, deps, row, actor.adminId, 'return rejected');
        return result.row;
      });
    },

    async requestInfo(actor, id, input) {
      return withLocked(
        id,
        async (trx, row) =>
          (
            await applyTransition(trx, deps, row, {
              toStatus: 'AWAITING_CUSTOMER',
              expectedStatus: input.expectedStatus,
              actor: adminActor(actor),
              eventType: 'INFO_REQUESTED',
              note: input.message,
              email: { template: 'return_info_requested', payload: { message: input.message } },
            })
          ).row,
      );
    },

    async markReceived(actor, id, input) {
      return withLocked(
        id,
        async (trx, row) =>
          (
            await applyTransition(trx, deps, row, {
              toStatus: RETURN_RECEIVED,
              expectedStatus: input.expectedStatus,
              actor: adminActor(actor),
              eventType: 'ITEM_RECEIVED',
              note: input.note ?? null,
              email: { template: 'return_item_received' },
            })
          ).row,
      );
    },

    async advance(actor, id, input) {
      if (DEDICATED_TARGETS.has(input.toStatus)) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          `Use the dedicated action for ${input.toStatus}.`,
        );
      }
      const sending = input.toStatus === EXCHANGE_SENT;
      if (!sending && (input.carrier !== undefined || input.trackingReference !== undefined)) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Carrier and tracking reference are only recorded when the replacement is sent.',
        );
      }
      return withLocked(id, async (trx, row) => {
        const result = await applyTransition(trx, deps, row, {
          toStatus: input.toStatus,
          expectedStatus: input.expectedStatus,
          actor: adminActor(actor),
          note: input.note ?? null,
          ...(sending && {
            values: {
              replacement_carrier: input.carrier ?? null,
              replacement_tracking_reference: input.trackingReference ?? null,
              replacement_sent_at: new Date(),
            },
            email: {
              template: 'return_exchange_sent' as const,
              payload: {
                carrier: input.carrier ?? null,
                trackingReference: input.trackingReference ?? null,
              },
            },
          }),
        });
        if (sending) await commitReplacement(trx, deps, row, actor.adminId);
        return result.row;
      });
    },

    async inspect(actor, id, input) {
      if (input.outcome === 'NOT_RESELLABLE' && input.restockQuantity !== undefined) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Items that are not resellable are never restocked.',
        );
      }
      try {
        return await withLocked(id, async (trx, row) => {
          if (row.status !== RETURN_RECEIVED) {
            throw new AppError(
              'RETURN_NOT_ALLOWED',
              HTTP_STATUS.CONFLICT,
              'Inspection is recorded once the item is received.',
            );
          }
          if (row.inspectionOutcome !== null) {
            throw new AppError(
              'RETURN_ALREADY_INSPECTED',
              HTTP_STATUS.CONFLICT,
              'This return was already inspected.',
            );
          }
          const restock =
            input.outcome === 'RESELLABLE' ? (input.restockQuantity ?? row.quantity) : 0;
          if (restock > row.quantity) {
            throw new AppError(
              'QUANTITY_LIMIT_EXCEEDED',
              HTTP_STATUS.CONFLICT,
              `At most ${row.quantity} can be restocked.`,
              {
                maxQuantity: row.quantity,
              },
            );
          }
          // Inspection first: the DB guard checks it before accepting the 'return' movement.
          const changed = await repository.update(trx, row.id, row.status, {
            inspection_outcome: input.outcome,
            inspected_at: new Date(),
            inspected_by: actor.adminId,
            inspection_notes: input.notes ?? null,
          });
          if (!changed) throw statusConflict(row.status);
          if (restock > 0) {
            await stock.addOnHand(trx, row.variantId, restock);
            await stock.logMovement(trx, {
              variantId: row.variantId,
              type: 'return',
              quantity: restock,
              returnRequestId: row.id,
              note: 'returned item inspected as resellable',
              adminId: actor.adminId,
            });
          }
          await repository.insertEvent(trx, {
            returnRequestId: row.id,
            type: 'INSPECTED',
            fromStatus: null,
            toStatus: null,
            actorType: 'ADMIN',
            actorId: actor.adminId,
            note: `${input.outcome}${restock > 0 ? ` (restocked ${restock})` : ''}${input.notes ? `: ${input.notes}` : ''}`,
            visibility: 'INTERNAL',
          });
          await writeAuditLog(trx, {
            adminId: actor.adminId,
            action: 'return.inspect',
            entityType: 'return_request',
            entityId: row.id,
            before: { inspectionOutcome: null },
            after: { inspectionOutcome: input.outcome, restocked: restock },
            ipAddress: actor.ipAddress,
          });
          const updated = await repository.find(trx, row.id);
          if (!updated) throw notFoundError('Return request');
          return updated;
        });
      } catch (err) {
        // The DB guard is the last line of defence (variant, quantity, inspection).
        if (isTriggerRejection(err)) {
          throw new AppError(
            'RETURN_NOT_ALLOWED',
            HTTP_STATUS.CONFLICT,
            'This restock is not allowed for this return.',
          );
        }
        throw err;
      }
    },

    async setResponsibility(actor, id, input) {
      return withLocked(id, async (trx, row) => {
        const decision =
          row.blueprintDecisionId === null
            ? undefined
            : await repository.decision(trx, row.blueprintDecisionId);
        const mode = (decision?.selectionMode ?? null) as SelectionMode | null;
        const problem = checkResponsibilityChange(input.responsibility, input.faultCause, mode);
        if (problem !== null) {
          throw new AppError(
            'INVALID_RESPONSIBILITY',
            HTTP_STATUS.BAD_REQUEST,
            problem === 'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION'
              ? 'A Blueprint failure needs a locked Blueprint recommendation on this item.'
              : 'This fault cause does not match the responsibility.',
            { problem },
          );
        }
        const payer = input.payer ?? DEFAULT_PAYER[input.responsibility];
        const changed = await repository.update(trx, row.id, row.status, {
          responsibility: input.responsibility,
          fault_cause: input.faultCause,
          reverse_logistics_payer: payer,
          responsibility_set_by: 'ADMIN',
          responsibility_set_at: new Date(),
          fault_basis: 'admin_review',
        });
        if (!changed) throw statusConflict(row.status);
        await repository.insertEvent(trx, {
          returnRequestId: row.id,
          type: 'RESPONSIBILITY_SET',
          fromStatus: null,
          toStatus: null,
          actorType: 'ADMIN',
          actorId: actor.adminId,
          note: `${row.responsibility} -> ${input.responsibility}${input.faultCause ? ` / ${input.faultCause}` : ''}, payer ${payer}: ${input.note}`,
          visibility: 'INTERNAL',
        });
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'return.responsibility_set',
          entityType: 'return_request',
          entityId: row.id,
          before: {
            responsibility: row.responsibility,
            faultCause: row.faultCause,
            payer: row.payer,
            setBy: row.responsibilitySetBy,
          },
          after: {
            responsibility: input.responsibility,
            faultCause: input.faultCause,
            payer,
            note: input.note,
          },
          ipAddress: actor.ipAddress,
        });
        const updated = await repository.find(trx, row.id);
        if (!updated) throw notFoundError('Return request');
        return updated;
      });
    },

    async addNote(actor, id, body) {
      return withLocked(id, async (trx, row) => {
        await repository.insertEvent(trx, {
          returnRequestId: row.id,
          type: 'ADMIN_NOTE',
          fromStatus: null,
          toStatus: null,
          actorType: 'ADMIN',
          actorId: actor.adminId,
          note: body,
          visibility: 'INTERNAL',
        });
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'return.note_add',
          entityType: 'return_request',
          entityId: row.id,
          after: { length: body.length },
          ipAddress: actor.ipAddress,
        });
        return row;
      });
    },
  };
}
