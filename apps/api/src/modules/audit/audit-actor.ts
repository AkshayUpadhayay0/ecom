import type { Request } from 'express';
import { getAdmin } from '../auth/core/principals.js';

/** Who performed an admin write; recorded in admin_audit_logs (and stock_movements). */
export interface AuditActor {
  adminId: string;
  ipAddress: string | null;
}

/** Use in handlers mounted behind requireAdmin. */
export function auditActorOf(req: Request): AuditActor {
  return { adminId: getAdmin(req).id, ipAddress: req.ip ?? null };
}
