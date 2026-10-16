import { Router, type RequestHandler } from 'express';
import {
  advanceReturnSchema,
  approveReturnSchema,
  cancelReturnSchema,
  createReturnSchema,
  inspectReturnSchema,
  listAdminReturnsQuerySchema,
  listMyReturnsQuerySchema,
  markReturnReceivedSchema,
  rejectReturnSchema,
  replyReturnSchema,
  requestReturnInfoSchema,
  returnNoteSchema,
  setReturnResponsibilitySchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import { getCustomer } from '../auth/core/principals.js';
import type { AdminReturnsService } from './admin-returns.service.js';
import type { CustomerReturnsService } from './customer-returns.service.js';

export const MY_RETURNS_PATH = '/me/returns';

// ---------- Customer ----------

export type CustomerReturnsController = Record<
  'create' | 'list' | 'get' | 'reply' | 'cancel',
  RequestHandler
>;
export type AdminReturnsController = Record<
  | 'list'
  | 'get'
  | 'approve'
  | 'reject'
  | 'requestInfo'
  | 'markReceived'
  | 'advance'
  | 'inspect'
  | 'setResponsibility'
  | 'addNote',
  RequestHandler
>;

export function createCustomerReturnsController(
  service: CustomerReturnsService,
): CustomerReturnsController {
  return {
    create: async (req, res) => {
      const input = createReturnSchema.parse(bodyOf(req));
      const result = await service.create(
        getCustomer(req).id,
        uuidParam(req, 'orderId'),
        uuidParam(req, 'itemId'),
        input,
      );
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.CREATED, result);
    },
    list: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendPage(
        res,
        await service.list(getCustomer(req).id, listMyReturnsQuerySchema.parse(req.query)),
      );
    },
    get: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.get(getCustomer(req).id, uuidParam(req)));
    },
    reply: async (req, res) => {
      const input = replyReturnSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.reply(getCustomer(req).id, uuidParam(req), input),
      );
    },
    cancel: async (req, res) => {
      const { reason } = cancelReturnSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.cancel(getCustomer(req).id, uuidParam(req), reason),
      );
    },
  };
}

/**
 * Customer return routes, mounted at the API root; every route requires a customer login.
 * Other customers' orders, items and requests are 404.
 */
export function createCustomerReturnsRouter(
  controller: CustomerReturnsController,
  guards: { requireCustomer: RequestHandler; writeLimit: RequestHandler },
): Router {
  const router = Router();
  const { requireCustomer, writeLimit } = guards;
  router.post(
    '/me/orders/:orderId/items/:itemId/returns',
    writeLimit,
    requireCustomer,
    controller.create,
  );
  router.get(MY_RETURNS_PATH, requireCustomer, controller.list);
  router.get(`${MY_RETURNS_PATH}/:id`, requireCustomer, controller.get);
  router.post(`${MY_RETURNS_PATH}/:id/reply`, writeLimit, requireCustomer, controller.reply);
  router.post(`${MY_RETURNS_PATH}/:id/cancel`, writeLimit, requireCustomer, controller.cancel);
  return router;
}

// ---------- Admin ----------

export function createAdminReturnsController(service: AdminReturnsService): AdminReturnsController {
  const id = (req: Parameters<RequestHandler>[0]) => uuidParam(req);
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listAdminReturnsQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(id(req)));
    },
    approve: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.approve(auditActorOf(req), id(req), approveReturnSchema.parse(bodyOf(req))),
      );
    },
    reject: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.reject(auditActorOf(req), id(req), rejectReturnSchema.parse(bodyOf(req))),
      );
    },
    requestInfo: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.requestInfo(
          auditActorOf(req),
          id(req),
          requestReturnInfoSchema.parse(bodyOf(req)),
        ),
      );
    },
    markReceived: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.markReceived(
          auditActorOf(req),
          id(req),
          markReturnReceivedSchema.parse(bodyOf(req)),
        ),
      );
    },
    advance: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.advance(auditActorOf(req), id(req), advanceReturnSchema.parse(bodyOf(req))),
      );
    },
    inspect: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.inspect(auditActorOf(req), id(req), inspectReturnSchema.parse(bodyOf(req))),
      );
    },
    setResponsibility: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.setResponsibility(
          auditActorOf(req),
          id(req),
          setReturnResponsibilitySchema.parse(bodyOf(req)),
        ),
      );
    },
    addNote: async (req, res) => {
      const { body } = returnNoteSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.addNote(auditActorOf(req), id(req), body));
    },
  };
}

/**
 * Mounted under /admin (requireAdmin). Review and fulfilment actions for every admin; changing
 * responsibility / cause / payer (who pays) is super_admin only (decision 16 Oct 2026).
 */
export function createAdminReturnsRouter(
  controller: AdminReturnsController,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();
  router.get('/returns', controller.list);
  router.get('/returns/:id', controller.get);
  router.post('/returns/:id/approve', controller.approve);
  router.post('/returns/:id/reject', controller.reject);
  router.post('/returns/:id/request-info', controller.requestInfo);
  router.post('/returns/:id/mark-received', controller.markReceived);
  router.post('/returns/:id/status', controller.advance);
  router.post('/returns/:id/inspect', controller.inspect);
  router.patch('/returns/:id/responsibility', requireSuperAdmin, controller.setResponsibility);
  router.post('/returns/:id/notes', controller.addNote);
  return router;
}
