import { Router, type RequestHandler } from 'express';
import {
  createOrderNoteSchema,
  listAdminOrdersQuerySchema,
  updateOrderStatusSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { AdminOrdersService } from './admin-orders.service.js';

export interface AdminOrdersController {
  list: RequestHandler;
  get: RequestHandler;
  updateStatus: RequestHandler;
  listNotes: RequestHandler;
  addNote: RequestHandler;
}

export function createAdminOrdersController(service: AdminOrdersService): AdminOrdersController {
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listAdminOrdersQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req)));
    },
    updateStatus: async (req, res) => {
      const id = uuidParam(req);
      const input = updateOrderStatusSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.updateStatus(auditActorOf(req), id, input));
    },
    listNotes: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.listNotes(uuidParam(req)));
    },
    addNote: async (req, res) => {
      const id = uuidParam(req);
      const { body } = createOrderNoteSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.addNote(auditActorOf(req), id, body));
    },
  };
}

/**
 * Mounted under /admin behind requireAdmin. Every admin role may read orders, add notes and
 * change order status (day-to-day fulfilment). Orders are never deleted.
 */
export function createAdminOrdersRouter(controller: AdminOrdersController): Router {
  const router = Router();
  router.get('/orders', controller.list);
  router.get('/orders/:id', controller.get);
  router.patch('/orders/:id/status', controller.updateStatus);
  router.get('/orders/:id/notes', controller.listNotes);
  router.post('/orders/:id/notes', controller.addNote);
  return router;
}
