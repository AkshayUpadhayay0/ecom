import type { Router, RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { createReservationsRepository } from '../inventory/reservations.repository.js';
import type { StorageProvider } from '../media/storage/storage-provider.js';
import { createEmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import { createAdminOrdersRepository } from '../orders/admin-orders.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { createAdminReturnsService } from './admin-returns.service.js';
import { createCustomerReturnsService } from './customer-returns.service.js';
import { createReturnStockRepository } from './return-stock.repository.js';
import type { WorkflowDeps } from './return-workflow.js';
import {
  createAdminReturnsController,
  createAdminReturnsRouter,
  createCustomerReturnsController,
  createCustomerReturnsRouter,
} from './returns.routes.js';
import { createReturnsRepository } from './returns.repository.js';

function workflowDeps(): WorkflowDeps {
  return {
    repository: createReturnsRepository(),
    stock: createReturnStockRepository(),
    reservations: createReservationsRepository(),
    outbox: createEmailOutboxRepository(),
  };
}

/** Customer routes: create from an order item, list, detail, reply, cancel. */
export function createCustomerReturnsModule(deps: {
  db: Database;
  logger: Logger;
  settings: SettingsService;
  requireCustomer: RequestHandler;
  writeLimit: RequestHandler;
}): Router {
  const service = createCustomerReturnsService({
    ...workflowDeps(),
    db: deps.db,
    logger: deps.logger,
    settings: deps.settings,
  });
  return createCustomerReturnsRouter(createCustomerReturnsController(service), {
    requireCustomer: deps.requireCustomer,
    writeLimit: deps.writeLimit,
  });
}

/** Admin routes (mounted inside the admin router, behind requireAdmin). */
export function createAdminReturnsModule(deps: {
  db: Database;
  logger: Logger;
  settings: SettingsService;
  storage: StorageProvider;
}): Router {
  const service = createAdminReturnsService({
    ...workflowDeps(),
    db: deps.db,
    logger: deps.logger,
    settings: deps.settings,
    storage: deps.storage,
    orderReads: createAdminOrdersRepository(),
  });
  return createAdminReturnsRouter(createAdminReturnsController(service));
}
