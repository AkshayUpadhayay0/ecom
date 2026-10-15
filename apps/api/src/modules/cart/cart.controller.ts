import type { RequestHandler } from 'express';
import {
  addCartItemSchema,
  replaceCartDecisionSchema,
  updateCartItemSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { CartService } from './cart.service.js';

export interface CartController {
  get: RequestHandler;
  addItem: RequestHandler;
  updateQuantity: RequestHandler;
  removeLine: RequestHandler;
  replaceDecision: RequestHandler;
}

export function createCartController(service: CartService): CartController {
  return {
    get: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.get(getCustomer(req).id));
    },
    addItem: async (req, res) => {
      const input = addCartItemSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.addItem(getCustomer(req).id, input));
    },
    updateQuantity: async (req, res) => {
      const { quantity } = updateCartItemSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.updateQuantity(getCustomer(req).id, uuidParam(req), quantity),
      );
    },
    removeLine: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.removeLine(getCustomer(req).id, uuidParam(req)));
    },
    replaceDecision: async (req, res) => {
      const { blueprintDecisionId } = replaceCartDecisionSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.replaceDecision(getCustomer(req).id, uuidParam(req), blueprintDecisionId),
      );
    },
  };
}
