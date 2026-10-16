import type { AdminCustomerDetailDto, AdminCustomerSummaryDto } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { int8ToNumber } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import type { AuditActor } from '../audit/audit-actor.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { SessionsRepository } from '../auth/core/sessions.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { AdminCustomerRow, AdminCustomersRepository } from './admin-customers.repository.js';

const DELETED = 'deleted';

export interface AdminCustomersService {
  list(query: {
    page: number;
    pageSize?: number | undefined;
    q?: string | undefined;
    status?: string | undefined;
  }): Promise<Page<AdminCustomerSummaryDto>>;
  get(id: string): Promise<AdminCustomerDetailDto>;
  /** Suspend (also revokes every session) or re-enable. Reason required; audited. */
  setStatus(
    actor: AuditActor,
    id: string,
    input: { status: 'active' | 'suspended'; reason: string },
  ): Promise<AdminCustomerDetailDto>;
}

function toSummary(row: AdminCustomerRow): AdminCustomerSummaryDto {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    orderCount: row.orderCount,
    paidTotalMinor: int8ToNumber(row.paidTotalMinor),
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}

export function createAdminCustomersService(deps: {
  db: Database;
  logger: Logger;
  repository: AdminCustomersRepository;
  sessions: SessionsRepository;
  settings: SettingsService;
}): AdminCustomersService {
  const { db, logger, repository, sessions, settings } = deps;

  async function load(executor: Database, id: string): Promise<AdminCustomerDetailDto> {
    const row = await repository.find(executor, id);
    if (!row) throw notFoundError('Customer');
    const [addresses, orders] = await Promise.all([
      repository.addresses(executor, id),
      repository.orders(executor, id),
    ]);
    return {
      ...toSummary(row),
      preferredLanguage: row.preferredLanguage,
      lockedUntil: row.lockedUntil?.toISOString() ?? null,
      addresses,
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        currency: order.currency.trim(),
        totalMinor: int8ToNumber(order.totalMinor),
        placedAt: order.placedAt.toISOString(),
      })),
    };
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(db, { q: query.q, status: query.status }, page);
      return { items: rows.map(toSummary), meta: toPageMeta(page, total) };
    },

    get: (id) => load(db, id),

    async setStatus(actor, id, input) {
      return db.transaction().execute(async (trx) => {
        const current = await repository.find(trx, id, true);
        if (!current) throw notFoundError('Customer');
        if (current.status === DELETED) {
          throw new AppError(
            'VALIDATION_ERROR',
            HTTP_STATUS.BAD_REQUEST,
            'A deleted account cannot be changed.',
          );
        }
        let revoked = 0;
        if (current.status !== input.status) {
          await repository.setStatus(trx, id, input.status);
          if (input.status === 'suspended') {
            // Refresh tokens stop working at once; an access token lives at most its short TTL.
            revoked = await sessions.revokeAllForSubject(trx, 'customer', id, 'admin');
          }
        }
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: input.status === 'suspended' ? 'customer.suspend' : 'customer.enable',
          entityType: 'customer',
          entityId: id,
          before: { status: current.status },
          after: { status: input.status, reason: input.reason, sessionsRevoked: revoked },
          ipAddress: actor.ipAddress,
        });
        logger.info(
          { customerId: id, status: input.status, adminId: actor.adminId },
          'customer status changed by admin',
        );
        return load(trx, id);
      });
    },
  };
}
