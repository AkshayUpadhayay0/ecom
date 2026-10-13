import type { RequestHandler } from 'express';
import {
  listMeasurementProfilesQuerySchema,
  listSizeChartGroupsQuerySchema,
  listSizeChartsQuerySchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { sendData, sendPage } from '../../lib/respond.js';
import type { SizeChartsService } from './size-charts.service.js';

export interface SizeChartsController {
  listGroups: RequestHandler;
  listCharts: RequestHandler;
  getChart: RequestHandler;
  listProfiles: RequestHandler;
}

export function createSizeChartsController(service: SizeChartsService): SizeChartsController {
  return {
    listGroups: async (req, res) => {
      sendPage(res, await service.listGroups(listSizeChartGroupsQuerySchema.parse(req.query)));
    },
    listCharts: async (req, res) => {
      const groupId = uuidParam(req, 'groupId');
      sendPage(res, await service.listCharts(groupId, listSizeChartsQuerySchema.parse(req.query)));
    },
    getChart: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.getChart(uuidParam(req, 'chartId')));
    },
    listProfiles: async (req, res) => {
      sendPage(
        res,
        await service.listProfiles(listMeasurementProfilesQuerySchema.parse(req.query)),
      );
    },
  };
}
