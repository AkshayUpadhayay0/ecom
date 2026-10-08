import type { RequestHandler } from 'express';
import { listAuditLogsQuerySchema, type ApiList, type AuditLogDto } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { AuditService } from './audit.service.js';

export interface AuditController {
  list: RequestHandler;
}

export function createAuditController(service: AuditService): AuditController {
  return {
    list: async (req, res) => {
      const page = await service.list(listAuditLogsQuerySchema.parse(req.query));
      const body: ApiList<AuditLogDto> = { data: page.items, meta: page.meta };
      res.status(HTTP_STATUS.OK).json(body);
    },
  };
}
