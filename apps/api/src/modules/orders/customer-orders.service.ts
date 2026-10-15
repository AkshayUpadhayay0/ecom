import type { OrderDto, OrderSummaryDto, PaginationQuery } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { notFoundError } from '../../lib/errors.js';
import { type Page, toPageMeta, toPageRequest } from '../../lib/pagination.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toOrderDto, toOrderSummaryDto } from './orders.dto.js';
import type { OrdersRepository } from './orders.repository.js';

export interface CustomerOrdersService {
  list(customerId: string, query: PaginationQuery): Promise<Page<OrderSummaryDto>>;
  /** Own orders only; anyone else's id is a plain 404. */
  get(customerId: string, orderId: string): Promise<OrderDto>;
}

export function createCustomerOrdersService(deps: {
  db: Database;
  repository: OrdersRepository;
  settings: SettingsService;
}): CustomerOrdersService {
  const { db, repository, settings } = deps;
  return {
    async list(customerId, query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.listForCustomer(db, customerId, page);
      return { items: rows.map(toOrderSummaryDto), meta: toPageMeta(page, total) };
    },

    async get(customerId, orderId) {
      const row = await repository.findOwned(db, orderId, customerId);
      if (!row) throw notFoundError('Order');
      return toOrderDto(row, await repository.items(db, [row.id]));
    },
  };
}
