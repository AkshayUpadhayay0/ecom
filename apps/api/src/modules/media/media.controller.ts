import type { RequestHandler } from 'express';
import {
  createEvidenceUploadSchema,
  createUploadSchema,
  listMediaQuerySchema,
  mediaPickerQuerySchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import { getCustomer } from '../auth/core/principals.js';
import type { MediaScope, MediaService } from './media.service.js';

export interface MediaController {
  createUpload: RequestHandler;
  completeUpload: RequestHandler;
  list: RequestHandler;
  picker: RequestHandler;
  get: RequestHandler;
  retry: RequestHandler;
  usage: RequestHandler;
  remove: RequestHandler;
  getUrl: RequestHandler;
  purge: RequestHandler;
  purgeRetired: RequestHandler;
  /** Customer route: signed URL for the customer's own return evidence. */
  getCustomerUrl: RequestHandler;
  createCustomerUpload: RequestHandler;
  completeCustomerUpload: RequestHandler;
}

/**
 * Decision 22 Oct 2026: the Media Library is for every admin and, for BOTH roles, only reaches
 * public media that no customer owns (private files / return evidence: 404; admin uploads are
 * public). Physical purge stays a separate super_admin route.
 */
function scopeOf(_req: Parameters<RequestHandler>[0]): MediaScope {
  return 'product';
}

export function createMediaController(service: MediaService): MediaController {
  return {
    createUpload: async (req, res) => {
      const input = createUploadSchema.parse(bodyOf(req));
      sendData(
        res,
        HTTP_STATUS.CREATED,
        await service.createUpload(auditActorOf(req), input, scopeOf(req)),
      );
    },
    completeUpload: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.completeUpload(auditActorOf(req), uuidParam(req), scopeOf(req)),
      );
    },
    list: async (req, res) => {
      sendPage(res, await service.list(listMediaQuerySchema.parse(req.query)));
    },
    picker: async (req, res) => {
      sendPage(res, await service.picker(mediaPickerQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(uuidParam(req), scopeOf(req)));
    },
    usage: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.usage(uuidParam(req), scopeOf(req)));
    },
    remove: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.delete(auditActorOf(req), uuidParam(req), scopeOf(req)),
      );
    },
    retry: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.retry(auditActorOf(req), uuidParam(req), scopeOf(req)),
      );
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
    createCustomerUpload: async (req, res) => {
      const input = createEvidenceUploadSchema.parse(bodyOf(req));
      res.set('Cache-Control', 'no-store');
      sendData(
        res,
        HTTP_STATUS.CREATED,
        await service.createCustomerUpload(getCustomer(req).id, input),
      );
    },
    completeCustomerUpload: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.completeCustomerUpload(getCustomer(req).id, uuidParam(req)),
      );
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
