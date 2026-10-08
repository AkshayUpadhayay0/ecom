import type { RequestHandler } from 'express';
import {
  createDeliveryZoneSchema,
  listDeliveryZonesQuerySchema,
  updateDeliveryZoneSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { DeliveryZonesService } from './delivery-zones.service.js';

export interface DeliveryZonesController {
  list: RequestHandler;
  get: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
}

export function createDeliveryZonesController(
  service: DeliveryZonesService,
): DeliveryZonesController {
  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listDeliveryZonesQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req)));
    },
    create: async (req, res) => {
      const input = createDeliveryZoneSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.create(auditActorOf(req), input));
    },
    update: async (req, res) => {
      const id = uuidParam(req);
      const input = updateDeliveryZoneSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.update(auditActorOf(req), id, input));
    },
  };
}
