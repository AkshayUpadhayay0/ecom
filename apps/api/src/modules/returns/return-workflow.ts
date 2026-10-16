import type { Updateable } from 'kysely';
import type { Database } from '../../db/database.js';
import type { ReturnRequests } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import type { ReturnEmailPayload, ReturnEmailTemplate } from '../notifications/email-templates.js';
import type { ReturnStockRepository } from './return-stock.repository.js';
import type { ReturnRow, ReturnsRepository } from './returns.repository.js';

/** SQLSTATE of RAISE EXCEPTION in our triggers (e.g. trg_stock_return_guard). */
export const RAISE_EXCEPTION = 'P0001';

export interface ReturnActor {
  type: 'ADMIN' | 'CUSTOMER';
  id: string;
  ipAddress: string | null;
}

export interface WorkflowDeps {
  repository: ReturnsRepository;
  stock: ReturnStockRepository;
  reservations: ReservationsRepository;
  outbox: EmailOutboxRepository;
}

export interface TransitionInput {
  toStatus: string;
  expectedStatus: string;
  actor: ReturnActor;
  note?: string | null;
  /** Event type (default STATUS_CHANGED). */
  eventType?: string;
  /** Extra columns written in the same compare-and-set update. */
  values?: Updateable<ReturnRequests>;
  email?: { template: ReturnEmailTemplate; payload?: Partial<ReturnEmailPayload> };
}

export function statusConflict(currentStatus: string): AppError {
  return new AppError(
    'RETURN_STATUS_CONFLICT',
    HTTP_STATUS.CONFLICT,
    'The request changed meanwhile. Reload it and try again.',
    {
      currentStatus,
    },
  );
}

export function isTriggerRejection(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === RAISE_EXCEPTION;
}

/** Queues one return email; the event id makes it unique (never twice for one event). */
export async function queueReturnEmail(
  trx: Database,
  outbox: EmailOutboxRepository,
  row: ReturnRow,
  eventId: string,
  email: { template: ReturnEmailTemplate; payload?: Partial<ReturnEmailPayload> },
): Promise<void> {
  await outbox.enqueue(trx, {
    template: email.template,
    recipient: row.contactEmail,
    languageCode: row.languageCode,
    orderId: row.orderId,
    dedupeKey: `return:${eventId}:${email.template}`,
    payload: {
      requestNumber: row.requestNumber,
      recipientName: row.recipientName,
      orderNumber: row.orderNumber,
      productName: row.productName,
      message: null,
      returnAddress: null,
      returnInstructions: null,
      carrier: null,
      trackingReference: null,
      ...email.payload,
    },
  });
}

/**
 * The one way a request changes workflow status: expectedStatus (optimistic concurrency) ->
 * return_status_transitions (actor, request type, reason, inspection) -> compare-and-set update
 * -> event (+ admin audit row) -> optional customer email. Caller holds the request row lock and
 * the transaction. Responsibility is never touched here (separate column, separate action).
 */
export async function applyTransition(
  trx: Database,
  deps: WorkflowDeps,
  row: ReturnRow,
  input: TransitionInput,
): Promise<{ eventId: string; row: ReturnRow }> {
  if (row.status !== input.expectedStatus) throw statusConflict(row.status);
  const transition = await deps.repository.findTransition(
    trx,
    row.status,
    input.toStatus,
    input.actor.type,
  );
  if (
    !transition ||
    (transition.requestType !== null && transition.requestType !== row.requestType)
  ) {
    const allowed = await deps.repository.transitionsFrom(
      trx,
      row.status,
      input.actor.type,
      row.requestType,
    );
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      HTTP_STATUS.CONFLICT,
      `This request cannot move from ${row.status} to ${input.toStatus}.`,
      {
        from: row.status,
        to: input.toStatus,
        allowed: allowed.map((t) => t.toStatus),
      },
    );
  }
  if (transition.requiresReason && (input.note === undefined || input.note === null)) {
    throw new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Request validation failed.', {
      issues: [{ path: 'reason', message: 'A reason is required for this change.' }],
    });
  }
  if (transition.requiresInspection && row.inspectionOutcome === null) {
    throw new AppError(
      'RETURN_NOT_ALLOWED',
      HTTP_STATUS.CONFLICT,
      'Record the inspection of the returned item first.',
    );
  }
  const terminal = await deps.repository.isTerminal(trx, input.toStatus);
  const changed = await deps.repository.update(trx, row.id, row.status, {
    status: input.toStatus,
    ...input.values,
    ...(terminal && { closed_at: new Date() }),
  });
  if (!changed) throw statusConflict(row.status);
  const eventId = await deps.repository.insertEvent(trx, {
    returnRequestId: row.id,
    type: input.eventType ?? 'STATUS_CHANGED',
    fromStatus: row.status,
    toStatus: input.toStatus,
    actorType: input.actor.type,
    actorId: input.actor.id,
    note: input.note ?? null,
    visibility: 'CUSTOMER',
  });
  if (input.actor.type === 'ADMIN') {
    await writeAuditLog(trx, {
      adminId: input.actor.id,
      action: 'return.status_change',
      entityType: 'return_request',
      entityId: row.id,
      before: { status: row.status },
      after: { status: input.toStatus, ...(input.note ? { note: input.note } : {}) },
      ipAddress: input.actor.ipAddress,
    });
  }
  if (input.email) await queueReturnEmail(trx, deps.outbox, row, eventId, input.email);
  const updated = await deps.repository.find(trx, row.id);
  if (!updated) throw new Error('Return request disappeared');
  return { eventId, row: updated };
}

// ---------- Exchange replacement stock (reserve at APPROVED; decision 16 Oct 2026) ----------

/** One conditional UPDATE (same as checkout) + a hold owned by the request. */
export async function reserveReplacement(
  trx: Database,
  deps: WorkflowDeps,
  row: ReturnRow,
  adminId: string,
): Promise<void> {
  if (row.requestType !== 'EXCHANGE' || row.replacementVariantId === null) return;
  if ((await deps.stock.holds(trx, row.id)).some((h) => h.status === 'held')) return;
  if (!(await deps.reservations.reserve(trx, row.replacementVariantId, row.quantity))) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      HTTP_STATUS.CONFLICT,
      'The replacement size is out of stock. The request was not approved.',
    );
  }
  await deps.stock.insertHold(trx, {
    returnRequestId: row.id,
    variantId: row.replacementVariantId,
    quantity: row.quantity,
  });
  await deps.stock.logMovement(trx, {
    variantId: row.replacementVariantId,
    type: 'reservation',
    quantity: row.quantity,
    returnRequestId: row.id,
    note: 'exchange replacement reserved (approved)',
    adminId,
  });
}

/** Gives held replacement units back (REJECTED / CANCELLED). Safe to repeat. */
export async function releaseReplacement(
  trx: Database,
  deps: WorkflowDeps,
  row: ReturnRow,
  adminId: string | null,
  note: string,
): Promise<void> {
  for (const hold of await deps.stock.holds(trx, row.id)) {
    if (hold.status !== 'held') continue;
    await deps.reservations.release(trx, hold.variantId, hold.quantity);
    await deps.stock.setHoldStatus(trx, hold.id, 'released');
    await deps.stock.logMovement(trx, {
      variantId: hold.variantId,
      type: 'reservation_release',
      quantity: hold.quantity,
      returnRequestId: row.id,
      note,
      adminId,
    });
  }
}

/** Replacement sent: held units leave stock (on-hand and reserved both drop). */
export async function commitReplacement(
  trx: Database,
  deps: WorkflowDeps,
  row: ReturnRow,
  adminId: string,
): Promise<void> {
  const held = (await deps.stock.holds(trx, row.id)).filter((h) => h.status === 'held');
  if (held.length === 0) {
    throw new AppError(
      'RETURN_NOT_ALLOWED',
      HTTP_STATUS.CONFLICT,
      'No replacement stock is held for this request.',
    );
  }
  for (const hold of held) {
    if (!(await deps.reservations.commitHeld(trx, hold.variantId, hold.quantity))) {
      throw new AppError(
        'INSUFFICIENT_STOCK',
        HTTP_STATUS.CONFLICT,
        'The held replacement stock is no longer available.',
      );
    }
    await deps.stock.setHoldStatus(trx, hold.id, 'committed');
    await deps.stock.logMovement(trx, {
      variantId: hold.variantId,
      type: 'reservation_release',
      quantity: hold.quantity,
      returnRequestId: row.id,
      note: 'replacement sent',
      adminId,
    });
    await deps.stock.logMovement(trx, {
      variantId: hold.variantId,
      type: 'sale',
      quantity: hold.quantity,
      returnRequestId: row.id,
      note: 'exchange replacement sent',
      adminId,
    });
  }
}
