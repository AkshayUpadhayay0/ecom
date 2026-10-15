import type { RequestHandler, Response } from 'express';
import {
  catalogQuerySchema,
  catalogSearchQuerySchema,
  productRefSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { stringParam } from '../../lib/params.js';
import type { PublicCatalogService } from './public-catalog.service.js';

export interface PublicCatalogController {
  list: RequestHandler;
  search: RequestHandler;
  detail: RequestHandler;
  clothingTypes: RequestHandler;
}

/**
 * Short shared caching; Express adds a weak ETag to every JSON body and answers 304 when the
 * client's If-None-Match still matches.
 */
export function publicCacheHeaders(res: Response, maxAgeSeconds: number): void {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}`);
}

export function createPublicCatalogController(
  service: PublicCatalogService,
  cacheMaxAgeSeconds: number,
): PublicCatalogController {
  const send = (res: Response, body: unknown): void => {
    publicCacheHeaders(res, cacheMaxAgeSeconds);
    res.status(HTTP_STATUS.OK).json(body);
  };
  return {
    list: async (req, res) => {
      send(res, await service.list(catalogQuerySchema.parse(req.query)));
    },
    search: async (req, res) => {
      send(res, await service.search(catalogSearchQuerySchema.parse(req.query)));
    },
    detail: async (req, res) => {
      const ref = stringParam(req, 'idOrSlug', productRefSchema);
      send(res, { data: await service.detail(ref) });
    },
    clothingTypes: async (_req, res) => {
      send(res, { data: await service.clothingTypes() });
    },
  };
}
