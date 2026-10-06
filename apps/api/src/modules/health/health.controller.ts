import type { RequestHandler } from 'express';
import type { ApiData, HealthDto } from '@urban-ibile/shared';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toHealthDto } from './health.dto.js';
import type { HealthService } from './health.service.js';

export interface HealthController {
  get: RequestHandler;
}

export function createHealthController(service: HealthService): HealthController {
  return {
    get: async (req, res) => {
      const report = await service.check();
      if (report.database === 'down') {
        // The reason is logged for operators but never sent to the client.
        req.log.error({ reason: report.reason }, 'health check: database unreachable');
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          'Database unavailable.',
        );
      }
      const body: ApiData<HealthDto> = { data: toHealthDto(process.uptime(), new Date()) };
      res.set('Cache-Control', 'no-store').status(HTTP_STATUS.OK).json(body);
    },
  };
}
