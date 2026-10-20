import { z } from 'zod';
import type {
  AdminOrderDetailDto,
  AdminOrderNoteDto,
  AdminOrderSummaryDto,
  ListAdminOrdersQuery,
  UpdateOrderStatusRequest,
} from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import { storeDateRange } from '../../lib/store-dates.js';
import type { AuditActor } from '../audit/audit-actor.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import { releaseOrderHolds } from '../inventory/order-holds.js';
import type { ReservationsRepository } from '../inventory/reservations.repository.js';
import type { EmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import type { EmailTemplate } from '../notifications/email-templates.js';
import type { PaymentReviewsRepository } from '../payments/payment-reviews.repository.js';
import { toResolutionDto } from '../payments/payment-reviews.dto.js';
import type { PaymentsRepository } from '../payments/payments.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type {
  AdminOrderDetailRow,
  AdminOrderFilters,
  AdminOrderSummaryRow,
  AdminOrdersRepository,
  HistoryRow,
  MeasurementRow,
} from './admin-orders.repository.js';
import type { OrderNoteRow, OrderNotesRepository } from './order-notes.repository.js';
import type { OrdersRepository } from './orders.repository.js';

const PAYMENT_REVIEW = 'payment_review';
const PAID = 'paid';
const CANCELLED = 'cancelled';
const SENT_OUT = 'sent_out';
const DELIVERED = 'delivered';
/** Status changes that notify the customer (template = order_<status>). */
const STATUS_EMAILS: Partial<Record<string, EmailTemplate>> = {
  [SENT_OUT]: 'order_sent_out',
  [DELIVERED]: 'order_delivered',
};

/** order_items.fit_snapshot: `charts` holds the decision's chart snapshot (with its charts). */
const fitSnapshotSchema = z.object({
  decisionId: z.string(),
  method: z.string(),
  selectionMode: z.string(),
  fitPreference: z.string(),
  recommendedSize: z.string(),
  selectedSize: z.string(),
  charts: z
    .object({ charts: z.array(z.object({ group: z.string(), version: z.number() })).default([]) })
    .nullish(),
});

export interface AdminOrdersService {
  list(query: ListAdminOrdersQuery): Promise<Page<AdminOrderSummaryDto>>;
  get(orderId: string): Promise<AdminOrderDetailDto>;
  updateStatus(
    actor: AuditActor,
    orderId: string,
    input: UpdateOrderStatusRequest,
  ): Promise<AdminOrderDetailDto>;
  listNotes(orderId: string): Promise<AdminOrderNoteDto[]>;
  addNote(actor: AuditActor, orderId: string, body: string): Promise<AdminOrderNoteDto>;
}

export interface AdminOrdersServiceDeps {
  db: Database;
  logger: Logger;
  repository: AdminOrdersRepository;
  orders: OrdersRepository;
  notes: OrderNotesRepository;
  reservations: ReservationsRepository;
  payments: PaymentsRepository;
  reviews: PaymentReviewsRepository;
  outbox: EmailOutboxRepository;
  settings: SettingsService;
}

function toSummaryDto(row: AdminOrderSummaryRow): AdminOrderSummaryDto {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    orderStatus: row.orderStatus,
    paymentStatus: row.paymentStatus,
    needsAttention: row.orderStatus === PAYMENT_REVIEW,
    customer: { id: row.customerId, fullName: row.customerName, email: row.customerEmail },
    recipientName: row.recipientName,
    contactPhone: row.contactPhone,
    deliveryZoneName: row.deliveryZoneName,
    currency: row.currency.trim(),
    totalMinor: int8ToNumber(row.totalMinor),
    itemCount: row.itemCount,
    placedAt: row.placedAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  };
}

function toNoteDto(row: OrderNoteRow): AdminOrderNoteDto {
  return {
    id: row.id,
    body: row.body,
    author: { id: row.adminId, name: row.adminName },
    createdAt: row.createdAt.toISOString(),
  };
}

function toHistoryDto(row: HistoryRow): AdminOrderDetailDto['history'][number] {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    actor:
      row.adminId === null
        ? { type: 'system', id: null, name: null }
        : { type: 'admin', id: row.adminId, name: row.adminName },
    createdAt: row.createdAt.toISOString(),
  };
}

function measurementsByDecision(
  rows: readonly MeasurementRow[],
): Map<string, AdminOrderDetailDto['items'][number]['measurements']> {
  const result = new Map<string, AdminOrderDetailDto['items'][number]['measurements']>();
  for (const row of rows) {
    const list = result.get(row.decisionId) ?? [];
    list.push({
      code: row.code,
      label: row.label,
      valueInches: Number(row.valueInches),
      requiredSize: row.requiredSize,
    });
    result.set(row.decisionId, list);
  }
  return result;
}

export function createAdminOrdersService(deps: AdminOrdersServiceDeps): AdminOrdersService {
  const {
    db,
    logger,
    repository,
    orders,
    notes,
    reservations,
    payments,
    reviews,
    outbox,
    settings,
  } = deps;

  async function loadDetail(executor: Database, orderId: string): Promise<AdminOrderDetailDto> {
    const row: AdminOrderDetailRow | undefined = await repository.findDetail(executor, orderId);
    if (!row) throw notFoundError('Order');
    const [items, paymentRows, history, noteRows, transitions] = await Promise.all([
      repository.items(executor, orderId),
      repository.payments(executor, orderId),
      repository.history(executor, orderId),
      notes.list(executor, orderId),
      repository.transitionsFrom(executor, row.orderStatus),
    ]);
    const decisionIds = items.flatMap((item) =>
      item.blueprintDecisionId === null ? [] : [item.blueprintDecisionId],
    );
    const [measurementRows, resolutionRows] = await Promise.all([
      repository.measurements(executor, decisionIds),
      reviews.resolutions(
        executor,
        paymentRows.map((p) => p.id),
      ),
    ]);
    const measurements = measurementsByDecision(measurementRows);
    return {
      ...toSummaryDto(row),
      sourceClient: row.sourceClient,
      languageCode: row.languageCode,
      subtotalMinor: int8ToNumber(row.subtotalMinor),
      deliveryFeeMinor: int8ToNumber(row.deliveryFeeMinor),
      contact: { email: row.contactEmail, phone: row.contactPhone },
      delivery: {
        recipientName: row.recipientName,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        state: row.state,
        landmark: row.landmark,
        zoneId: row.deliveryZoneId,
        zoneName: row.deliveryZoneName,
      },
      carrier: row.carrier,
      trackingReference: row.trackingReference,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      reservationExpiresAt: row.reservationExpiresAt?.toISOString() ?? null,
      items: items.map((item) => {
        const fit = fitSnapshotSchema.safeParse(item.fitSnapshot);
        return {
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          clothingTypeName: item.clothingTypeName,
          sizeLabel: item.sizeLabel,
          sku: item.sku,
          quantity: item.quantity,
          unitPriceMinor: int8ToNumber(item.unitPriceMinor),
          lineTotalMinor: int8ToNumber(item.lineTotalMinor),
          fit: fit.success
            ? {
                decisionId: fit.data.decisionId,
                method: fit.data.method,
                selectionMode: fit.data.selectionMode,
                fitPreference: fit.data.fitPreference,
                recommendedSize: fit.data.recommendedSize,
                selectedSize: fit.data.selectedSize,
                charts: (fit.data.charts?.charts ?? []).map((c) => ({
                  group: c.group,
                  version: c.version,
                })),
              }
            : null,
          measurements:
            item.blueprintDecisionId === null
              ? []
              : (measurements.get(item.blueprintDecisionId) ?? []),
        };
      }),
      payments: paymentRows.map((p) => ({
        id: p.id,
        reference: p.reference,
        provider: p.provider,
        status: p.status,
        amountMinor: int8ToNumber(p.amountMinor),
        currency: p.currency.trim(),
        channel: p.channel,
        failureReason: p.failureReason,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
      history: history.map(toHistoryDto),
      notes: noteRows.map(toNoteDto),
      reviewResolutions: resolutionRows.map(toResolutionDto),
      allowedTransitions: transitions.map((t) => ({
        toStatus: t.toStatus,
        requiresPaid: t.requiresPaid,
        requiresReason: t.requiresReason,
      })),
    };
  }

  async function assertOrderExists(executor: Database, orderId: string): Promise<void> {
    if (!(await orders.findById(executor, orderId))) throw notFoundError('Order');
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      // `to` is inclusive: a date-only value covers that whole day in the store time zone.
      const range = storeDateRange(
        query.from,
        query.to,
        await settings.getSetting(db, 'store.timezone'),
      );
      const filters: AdminOrderFilters = {
        orderStatus: query.orderStatus,
        paymentStatus: query.paymentStatus,
        from: range.from,
        toExclusive: range.toExclusive,
        deliveryZoneId: query.deliveryZoneId,
        needsAttention: query.needsAttention,
        q: query.q,
        sort: query.sort,
        order: query.order,
      };
      const { rows, total } = await repository.list(db, filters, page);
      return { items: rows.map(toSummaryDto), meta: toPageMeta(page, total) };
    },

    get: (orderId) => loadDetail(db, orderId),

    async updateStatus(actor, orderId, input) {
      if (
        (input.carrier !== undefined || input.trackingReference !== undefined) &&
        input.toStatus !== SENT_OUT
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Request validation failed.',
          {
            issues: [
              {
                path: 'carrier',
                message:
                  'Carrier and tracking reference are only recorded when moving to sent_out.',
              },
            ],
          },
        );
      }
      const graceMinutes = await settings.getLimit(db, 'payments.reconcile_after_minutes');
      return db.transaction().execute(async (trx) => {
        const order = await orders.lockById(trx, orderId);
        if (!order) throw notFoundError('Order');
        if (order.orderStatus !== input.expectedStatus) {
          throw new AppError(
            'ORDER_STATUS_CONFLICT',
            HTTP_STATUS.CONFLICT,
            'The order status changed meanwhile. Reload the order and try again.',
            {
              currentStatus: order.orderStatus,
            },
          );
        }
        const transition = await repository.findTransition(trx, order.orderStatus, input.toStatus);
        if (!transition) {
          const allowed = await repository.transitionsFrom(trx, order.orderStatus);
          throw new AppError(
            'INVALID_STATUS_TRANSITION',
            HTTP_STATUS.CONFLICT,
            `An order cannot move from ${order.orderStatus} to ${input.toStatus}.`,
            {
              from: order.orderStatus,
              to: input.toStatus,
              allowed: allowed.map((t) => t.toStatus),
            },
          );
        }
        if (transition.requiresPaid && order.paymentStatus !== PAID) {
          throw new AppError('ORDER_NOT_PAID', HTTP_STATUS.CONFLICT, 'This order is not paid yet.');
        }
        if (transition.requiresReason && input.reason === undefined) {
          throw new AppError(
            'VALIDATION_ERROR',
            HTTP_STATUS.BAD_REQUEST,
            'Request validation failed.',
            {
              issues: [{ path: 'reason', message: 'A reason is required for this change.' }],
            },
          );
        }

        const cancelling = input.toStatus === CANCELLED;
        if (cancelling) {
          // A customer may be paying right now: do not cancel under them by accident.
          if (
            input.confirmInFlight !== true &&
            (await payments.hasRecentUnresolved(trx, order.id, graceMinutes))
          ) {
            throw new AppError(
              'PAYMENT_IN_PROGRESS',
              HTTP_STATUS.CONFLICT,
              'A payment for this order was started recently and is not resolved yet. Send confirmInFlight: true to cancel anyway.',
              { graceMinutes },
            );
          }
          await releaseOrderHolds(trx, reservations, order.id, 'order cancelled by admin');
        }
        const changed = await repository.applyStatusChange(trx, {
          orderId: order.id,
          expectedStatus: input.expectedStatus,
          toStatus: input.toStatus,
          carrier: input.carrier,
          trackingReference: input.trackingReference,
          markDelivered: input.toStatus === DELIVERED,
          cancelReason: cancelling ? input.reason : undefined,
        });
        if (!changed) {
          throw new AppError(
            'ORDER_STATUS_CONFLICT',
            HTTP_STATUS.CONFLICT,
            'The order status changed meanwhile. Reload the order and try again.',
          );
        }
        const note =
          input.reason ??
          ([
            input.carrier && `carrier: ${input.carrier}`,
            input.trackingReference && `tracking: ${input.trackingReference}`,
          ]
            .filter(Boolean)
            .join(', ') ||
            'status updated by admin');
        await orders.logStatus(
          trx,
          order.id,
          order.orderStatus,
          input.toStatus,
          note,
          actor.adminId,
        );
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'order.status_change',
          entityType: 'order',
          entityId: order.id,
          before: { orderStatus: order.orderStatus },
          after: {
            orderStatus: input.toStatus,
            ...(input.reason !== undefined && { reason: input.reason }),
            ...(input.carrier !== undefined && { carrier: input.carrier }),
            ...(input.trackingReference !== undefined && {
              trackingReference: input.trackingReference,
            }),
            ...(input.confirmInFlight === true && { confirmInFlight: true }),
          },
          ipAddress: actor.ipAddress,
        });
        const template = STATUS_EMAILS[input.toStatus];
        if (template !== undefined) {
          // Unique per (order, template): a repeat never queues a second email.
          await outbox.enqueue(trx, {
            template,
            recipient: order.contactEmail,
            languageCode: order.languageCode,
            orderId: order.id,
            payload: {
              orderNumber: order.orderNumber,
              recipientName: order.recipientName,
              carrier: input.carrier ?? null,
              trackingReference: input.trackingReference ?? null,
            },
          });
        }
        logger.info(
          {
            orderId: order.id,
            from: order.orderStatus,
            to: input.toStatus,
            adminId: actor.adminId,
          },
          'order status changed by admin',
        );
        return loadDetail(trx, order.id);
      });
    },

    async listNotes(orderId) {
      await assertOrderExists(db, orderId);
      return (await notes.list(db, orderId)).map(toNoteDto);
    },

    async addNote(actor, orderId, body) {
      return db.transaction().execute(async (trx) => {
        await assertOrderExists(trx, orderId);
        const id = await notes.insert(trx, { orderId, adminId: actor.adminId, body });
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'order.note_add',
          entityType: 'order',
          entityId: orderId,
          after: { noteId: id, length: body.length },
          ipAddress: actor.ipAddress,
        });
        const created = (await notes.list(trx, orderId)).find((note) => note.id === id);
        if (!created) throw new Error('Inserted note not found');
        return toNoteDto(created);
      });
    },
  };
}
