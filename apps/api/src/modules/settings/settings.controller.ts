import type { RequestHandler } from 'express';
import { updateSettingSchema, type ApiData, type SettingDto } from '@urban-ibile/shared';
import { z } from 'zod';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { stringParam } from '../../lib/params.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { SettingsService } from './settings.service.js';

const settingKeyParam = z.string().min(1).max(100);

export interface SettingsController {
  list: RequestHandler;
  update: RequestHandler;
}

export function createSettingsController(service: SettingsService): SettingsController {
  return {
    list: async (_req, res) => {
      const body: ApiData<SettingDto[]> = { data: await service.list() };
      res.status(HTTP_STATUS.OK).json(body);
    },

    update: async (req, res) => {
      const key = stringParam(req, 'key', settingKeyParam);
      const { value } = updateSettingSchema.parse(req.body ?? {});
      const body: ApiData<SettingDto> = {
        data: await service.update(auditActorOf(req), key, value),
      };
      res.status(HTTP_STATUS.OK).json(body);
    },
  };
}
