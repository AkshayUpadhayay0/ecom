import { Router, type RequestHandler } from 'express';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { sendData } from '../../lib/respond.js';
import type { StatsService } from './stats.service.js';

export function createStatsController(service: StatsService): { overview: RequestHandler } {
  return {
    overview: async (_req, res) => {
      res.set('Cache-Control', 'private, no-store');
      sendData(res, HTTP_STATUS.OK, await service.overview());
    },
  };
}

/** Mounted under /admin (every admin role). */
export function createStatsRouter(controller: { overview: RequestHandler }): Router {
  const router = Router();
  router.get('/stats/overview', controller.overview);
  return router;
}
