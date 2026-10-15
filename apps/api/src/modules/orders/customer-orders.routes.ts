import { Router, type RequestHandler } from 'express';
import { listOrdersQuerySchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { sendData, sendPage } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { CustomerOrdersService } from './customer-orders.service.js';

export const MY_ORDERS_PATH = '/me/orders';

export interface CustomerOrdersController {
  list: RequestHandler;
  get: RequestHandler;
}

export function createCustomerOrdersController(
  service: CustomerOrdersService,
): CustomerOrdersController {
  return {
    list: async (req, res) => {
      const query = listOrdersQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      sendPage(res, await service.list(getCustomer(req).id, query));
    },
    get: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.get(getCustomer(req).id, uuidParam(req)));
    },
  };
}

/** The customer's own orders. Mounted at MY_ORDERS_PATH. */
export function createCustomerOrdersRouter(
  controller: CustomerOrdersController,
  requireCustomer: RequestHandler,
): Router {
  const router = Router();
  router.use(requireCustomer);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  return router;
}
