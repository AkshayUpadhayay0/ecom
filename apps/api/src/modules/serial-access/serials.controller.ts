import type { RequestHandler } from 'express';
import {
  deactivateSerialSchema,
  listSerialBatchesQuerySchema,
  serialImportQuerySchema,
} from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { SerialsService } from './serials.service.js';

export interface SerialsController {
  importCsv: RequestHandler;
  deactivate: RequestHandler;
  listBatches: RequestHandler;
}

export function createSerialsController(service: SerialsService): SerialsController {
  return {
    importCsv: async (req, res) => {
      if (typeof req.body !== 'string' || req.body.trim() === '') {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Send the CSV file as the request body with Content-Type: text/csv.',
        );
      }
      const query = serialImportQuerySchema.parse(req.query);
      const result = await service.importCsv(auditActorOf(req), req.body, query);
      sendData(res, query.dryRun ? HTTP_STATUS.OK : HTTP_STATUS.CREATED, result);
    },
    deactivate: async (req, res) => {
      const { serial } = deactivateSerialSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.deactivate(auditActorOf(req), serial));
    },
    listBatches: async (req, res) => {
      sendPage(res, await service.listBatches(listSerialBatchesQuerySchema.parse(req.query)));
    },
  };
}
