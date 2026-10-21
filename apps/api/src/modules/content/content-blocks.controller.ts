import type { RequestHandler } from 'express';
import {
  contentBlockKeySchema,
  listContentBlocksQuerySchema,
  setContentMediaSchema,
  updateContentTextSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { stringParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { ContentBlocksService } from './content-blocks.service.js';

export interface ContentBlocksController {
  list: RequestHandler;
  get: RequestHandler;
  publish: RequestHandler;
  unpublish: RequestHandler;
  setMedia: RequestHandler;
  setText: RequestHandler;
  resetText: RequestHandler;
}

export function createContentBlocksController(
  service: ContentBlocksService,
): ContentBlocksController {
  const keyOf = (req: Parameters<RequestHandler>[0]) =>
    stringParam(req, 'key', contentBlockKeySchema);

  return {
    list: async (req, res) => {
      sendPage(res, await service.list(listContentBlocksQuerySchema.parse(req.query)));
    },
    get: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.get(keyOf(req)));
    },
    publish: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.setPublished(auditActorOf(req), keyOf(req), true),
      );
    },
    unpublish: async (req, res) => {
      sendData(
        res,
        HTTP_STATUS.OK,
        await service.setPublished(auditActorOf(req), keyOf(req), false),
      );
    },
    setMedia: async (req, res) => {
      const key = keyOf(req);
      const { mediaAssetId } = setContentMediaSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.setMedia(auditActorOf(req), key, mediaAssetId));
    },
    resetText: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await service.resetText(auditActorOf(req), keyOf(req)));
    },
    setText: async (req, res) => {
      const key = keyOf(req);
      const text = updateContentTextSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await service.setText(auditActorOf(req), key, text));
    },
  };
}
