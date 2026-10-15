import type { RequestHandler } from 'express';
import {
  createBodyScanSessionSchema,
  decisionRequestSchema,
  listDecisionsQuerySchema,
  recommendationRequestSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { getCustomer } from '../auth/core/principals.js';
import type { BodyScanService } from '../body-scan/body-scan.service.js';
import type { BlueprintService } from './blueprint.service.js';

export interface BlueprintController {
  requirements: RequestHandler;
  recommend: RequestHandler;
  decide: RequestHandler;
  getDecision: RequestHandler;
  listMyDecisions: RequestHandler;
  createScan: RequestHandler;
  getScan: RequestHandler;
}

export function createBlueprintController(
  blueprint: BlueprintService,
  bodyScan: BodyScanService,
): BlueprintController {
  return {
    requirements: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await blueprint.requirements(uuidParam(req, 'productId')));
    },
    recommend: async (req, res) => {
      const input = recommendationRequestSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await blueprint.recommend(getCustomer(req).id, input));
    },
    decide: async (req, res) => {
      const input = decisionRequestSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await blueprint.decide(getCustomer(req).id, input));
    },
    getDecision: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await blueprint.getDecision(getCustomer(req).id, uuidParam(req)),
      );
    },
    listMyDecisions: async (req, res) => {
      const query = listDecisionsQuerySchema.parse(req.query);
      sendPage(res, await blueprint.listDecisions(getCustomer(req).id, query));
    },
    createScan: async (req, res) => {
      const { productId } = createBodyScanSessionSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await bodyScan.create(getCustomer(req).id, productId));
    },
    getScan: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await bodyScan.get(getCustomer(req).id, uuidParam(req)));
    },
  };
}
