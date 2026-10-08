import { Router, type RequestHandler } from 'express';
import type { AuditController } from './audit.controller.js';

export interface AuditRouteDeps {
  controller: AuditController;
  /** The audit trail is limited to super admins. */
  requireSuperAdmin: RequestHandler;
}

/** Mounted under /admin behind requireAdmin. */
export function createAuditRouter({ controller, requireSuperAdmin }: AuditRouteDeps): Router {
  const router = Router();
  router.get('/audit-logs', requireSuperAdmin, controller.list);
  return router;
}
