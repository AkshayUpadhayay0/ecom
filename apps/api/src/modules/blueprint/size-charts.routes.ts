import { Router, type RequestHandler } from 'express';
import type { SizeChartsController } from './size-charts.controller.js';

/**
 * Read-only Size Charts viewer, mounted under /admin behind requireAdmin. There are no write
 * routes: charts and profiles are loaded by developers. Chart grids, versions and warnings are
 * an internal (super_admin) tool; measurement profile names stay readable by every admin
 * because the product form needs them.
 */
export function createSizeChartsRouter(
  controller: SizeChartsController,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();
  router.get('/size-chart-groups', requireSuperAdmin, controller.listGroups);
  router.get('/size-chart-groups/:groupId/charts', requireSuperAdmin, controller.listCharts);
  router.get('/size-charts/:chartId', requireSuperAdmin, controller.getChart);
  router.get('/measurement-profiles', controller.listProfiles);
  return router;
}
