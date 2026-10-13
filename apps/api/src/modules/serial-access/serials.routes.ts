import express, { Router, type RequestHandler } from 'express';
import type { SerialsController } from './serials.controller.js';

/** CSV uploads: ~20k rows of short serials fit well inside this. */
const CSV_BODY_LIMIT = '2mb';

export interface SerialsRouteDeps {
  controller: SerialsController;
  /** Serial imports and deactivations are limited to super admins. */
  requireSuperAdmin: RequestHandler;
}

/**
 * Mounted under /admin behind requireAdmin. There is intentionally no endpoint that lists
 * serials: only batches (counts) can be listed.
 */
export function createSerialsRouter({ controller, requireSuperAdmin }: SerialsRouteDeps): Router {
  const router = Router();
  router.post(
    '/serial-imports',
    requireSuperAdmin,
    express.text({ type: ['text/csv', 'text/plain'], limit: CSV_BODY_LIMIT }),
    controller.importCsv,
  );
  router.get('/serial-batches', requireSuperAdmin, controller.listBatches);
  router.post('/serials/deactivate', requireSuperAdmin, controller.deactivate);
  return router;
}
