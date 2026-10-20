import { contentBlockKeySchema } from '@urban-ibile/shared';
import { Router, type RequestHandler } from 'express';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { stringParam } from '../../lib/params.js';
import { publicCacheHeaders } from '../catalog/public-catalog.controller.js';
import type { SiteConfigService } from './site-config.service.js';

export const SITE_PATH = '/site';

/** Public storefront configuration (no login). Mounted at SITE_PATH. */
export function createSiteConfigRouter(
  service: SiteConfigService,
  rateLimit: RequestHandler,
  cacheMaxAgeSeconds: number,
): Router {
  const router = Router();
  router.use(rateLimit);
  router.get('/config', async (_req, res) => {
    const data = await service.get();
    publicCacheHeaders(res, cacheMaxAgeSeconds);
    res.status(HTTP_STATUS.OK).json({ data });
  });
  // Footer and policy text (published text blocks only).
  router.get('/content/:key', async (req, res) => {
    const data = await service.content(stringParam(req, 'key', contentBlockKeySchema));
    publicCacheHeaders(res, cacheMaxAgeSeconds);
    res.status(HTTP_STATUS.OK).json({ data });
  });
  return router;
}
