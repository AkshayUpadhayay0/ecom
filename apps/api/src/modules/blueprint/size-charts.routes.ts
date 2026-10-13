import { Router } from 'express';
import type { SizeChartsController } from './size-charts.controller.js';

/**
 * Read-only Size Charts viewer, mounted under /admin behind requireAdmin. There are no write
 * routes: charts and profiles are loaded by developers until the Blueprint phase.
 */
export function createSizeChartsRouter(controller: SizeChartsController): Router {
  const router = Router();
  router.get('/size-chart-groups', controller.listGroups);
  router.get('/size-chart-groups/:groupId/charts', controller.listCharts);
  router.get('/size-charts/:chartId', controller.getChart);
  router.get('/measurement-profiles', controller.listProfiles);
  return router;
}
