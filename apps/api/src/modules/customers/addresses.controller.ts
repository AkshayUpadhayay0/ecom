import type { RequestHandler } from 'express';
import { createAddressSchema, updateAddressSchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { AddressesService } from './addresses.service.js';

export interface AddressesController {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
}

export function createAddressesController(service: AddressesService): AddressesController {
  return {
    list: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.list(getCustomer(req).id));
    },
    create: async (req, res) => {
      const input = createAddressSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.create(getCustomer(req).id, input));
    },
    update: async (req, res) => {
      const input = updateAddressSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.update(getCustomer(req).id, uuidParam(req), input),
      );
    },
    remove: async (req, res) => {
      await service.remove(getCustomer(req).id, uuidParam(req));
      res.status(HTTP_STATUS.NO_CONTENT).end();
    },
  };
}
