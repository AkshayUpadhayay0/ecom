import type { RequestHandler } from 'express';
import type { WebRevalidator } from '../lib/web-revalidate.js';

/** Admin areas whose changes can alter what the public website shows. */
const PUBLIC_AREAS =
  /^\/(media|content-blocks|products|clothing-types|variants|delivery-zones|settings)(\/|$)/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Mounted on the admin router: after a SUCCESSFUL admin write in an area the website shows (media,
 * content, products, clothing types, stock, delivery, settings) the website is told to refresh its
 * public data. The admin response is already sent; this never slows or fails the admin action.
 */
export function revalidateWebsiteAfterAdminWrites(revalidator: WebRevalidator): RequestHandler {
  return (req, res, next) => {
    if (revalidator.enabled && WRITE_METHODS.has(req.method)) {
      // Taken now: Express rewrites req.url while routing, so it is not reliable at 'finish'.
      const path = req.path;
      res.on('finish', () => {
        if (res.statusCode < 400 && PUBLIC_AREAS.test(path)) {
          revalidator.revalidate(`admin ${req.method} ${path.split('/')[1] ?? ''}`);
        }
      });
    }
    next();
  };
}
