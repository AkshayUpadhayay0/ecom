import type { RequestHandler } from 'express';
import { createUploadSchema, listMediaQuerySchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import { getCustomer } from '../auth/core/principals.js';
import type { MediaService } from './media.service.js';

export interface MediaController {
  createUpload: RequestHandler;
  completeUpload: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  getUrl: RequestHandler;
  purge: RequestHandler;
  purgeRetired: RequestHandler;
  /** Customer route: signed URL for the customer's own return evidence. */
  getCustomerUrl: RequestHandler;
}

export function createMediaController(service: MediaService): MediaController {
  return {
    createUpload: async (req, res) => {
      const input = createUploadSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await service.createUpload(auditActorOf(req), input));
    },
    completeUpload: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.completeUpload(auditActorOf(req), uuidParam(req)),
      );
    },
    list: async (req, res) => {
      sendPage(res, await service.list(listMediaQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req)));
    },
    getUrl: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(res, HTTP_STATUS.OK, await service.getUrlForAdmin(uuidParam(req)));
    },
    purge: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.purge(auditActorOf(req), uuidParam(req)));
    },
    purgeRetired: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.purgeRetired(auditActorOf(req)));
    },
    getCustomerUrl: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.getUrlForCustomer(getCustomer(req).id, uuidParam(req)),
      );
    },
  };
}
