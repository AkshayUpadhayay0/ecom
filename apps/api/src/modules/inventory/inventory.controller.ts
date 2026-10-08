import type { RequestHandler } from 'express';
import {
  createVariantSchema,
  listLowStockQuerySchema,
  listStockMovementsQuerySchema,
  listVariantsQuerySchema,
  stockAdjustmentSchema,
  updateVariantSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { InventoryService } from './inventory.service.js';

export interface InventoryController {
  listVariants: RequestHandler;
  createVariant: RequestHandler;
  updateVariant: RequestHandler;
  adjustStock: RequestHandler;
  listMovements: RequestHandler;
  listLowStock: RequestHandler;
}

export function createInventoryController(service: InventoryService): InventoryController {
  return {
    listVariants: async (req, res) => {
      const productId = uuidParam(req, 'productId');
      sendPage(
        res,
        await service.listVariants(productId, listVariantsQuerySchema.parse(req.query)),
      );
    },
    createVariant: async (req, res) => {
      const productId = uuidParam(req, 'productId');
      const input = createVariantSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.CREATED,
        await service.createVariant(auditActorOf(req), productId, input),
      );
    },
    updateVariant: async (req, res) => {
      const id = uuidParam(req);
      const input = updateVariantSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.updateVariant(auditActorOf(req), id, input));
    },
    adjustStock: async (req, res) => {
      const id = uuidParam(req);
      const input = stockAdjustmentSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.adjustStock(auditActorOf(req), id, input));
    },
    listMovements: async (req, res) => {
      const id = uuidParam(req);
      sendPage(
        res,
        await service.listMovements(id, listStockMovementsQuerySchema.parse(req.query)),
      );
    },
    listLowStock: async (req, res) => {
      sendPage(res, await service.listLowStock(listLowStockQuerySchema.parse(req.query)));
    },
  };
}
