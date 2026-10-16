import { Router, type RequestHandler } from 'express';
import { listAdminCustomersQuerySchema, updateCustomerStatusSchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { AdminCustomersService } from './admin-customers.service.js';

export interface AdminCustomersController {
  list: RequestHandler;
  get: RequestHandler;
  setStatus: RequestHandler;
}

export function createAdminCustomersController(
  service: AdminCustomersService,
): AdminCustomersController {
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listAdminCustomersQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req)));
    },
    setStatus: async (req, res) => {
      const id = uuidParam(req);
      const input = updateCustomerStatusSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.setStatus(auditActorOf(req), id, input));
    },
  };
}

/** Mounted under /admin. Lookup for every admin; suspend / enable super_admin only. */
export function createAdminCustomersRouter(deps: {
  controller: AdminCustomersController;
  requireSuperAdmin: RequestHandler;
}): Router {
  const router = Router();
  router.get('/customers', deps.controller.list);
  router.get('/customers/:id', deps.controller.get);
  router.patch('/customers/:id/status', deps.requireSuperAdmin, deps.controller.setStatus);
  return router;
}
