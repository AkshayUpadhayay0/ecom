import { z } from 'zod';
import { paginationQuerySchema } from './admin-common.js';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  adminId: z.uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  /** ISO-8601 date-times; `from` inclusive, `to` exclusive. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export interface AuditLogDto {
  id: string;
  admin: { id: string; email: string; displayName: string };
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
}
