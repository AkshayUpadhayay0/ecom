import { Router, type RequestHandler } from 'express';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { sendData } from '../../lib/respond.js';
import { getAdmin } from '../auth/core/principals.js';
import type { StatsService } from './stats.service.js';

export function createStatsController(service: StatsService): { overview: RequestHandler } {
  return {
    overview: async (req, res) => {
      res.set('Cache-Control', 'private, no-store');
      const stats = await service.overview();
      if (getAdmin(req).role === 'super_admin') {
        sendData(res, HTTP_STATUS.OK, stats);
        return;
      }
      // Developer-only figures are left out for the client's staff (decision 19 Oct 2026).
      const { failedMediaJobs: _internal, ...forAdmin } = stats;
      sendData(res, HTTP_STATUS.OK, forAdmin);
    },
  };
}

/** Mounted under /admin (every admin role). */
export function createStatsRouter(controller: { overview: RequestHandler }): Router {
  const router = Router();
  router.get('/stats/overview', controller.overview);
  return router;
}
