import { Router, type Response } from 'express';
import { AppError } from '../../../lib/errors.js';
import { HTTP_STATUS } from '../../../lib/http-status.js';
import { LocalUploadError, type LocalStorage } from './local-storage.js';

function notFound(): AppError {
  return new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, 'Not found.');
}

async function sendObject(
  storage: LocalStorage,
  res: Response,
  bucket: 'public' | 'private',
  key: string,
): Promise<void> {
  let found;
  try {
    found = await storage.locate(bucket, key);
  } catch {
    throw notFound(); // unsafe key
  }
  if (!found) throw notFound();
  res.type(found.contentType);
  res.set('X-Content-Type-Options', 'nosniff');
  if (bucket === 'private') res.set('Cache-Control', 'private, no-store');
  res.sendFile(found.path);
}

/**
 * MOCK presigned-URL endpoints for MEDIA_STORAGE_DRIVER=local (dev/test only; never mounted with
 * R2). Upload and private download need a valid HMAC token; nothing is listable.
 */
export function createLocalMediaRouter(storage: LocalStorage): Router {
  const router = Router();

  router.put('/upload/:token', async (req, res) => {
    const token = storage.verifyToken(req.params.token);
    if (!token || token.op !== 'put') {
      throw new AppError('FORBIDDEN', HTTP_STATUS.FORBIDDEN, 'Upload URL is invalid or expired.');
    }
    try {
      await storage.receiveUpload(token, req.get('content-type'), req);
    } catch (err) {
      if (err instanceof LocalUploadError) {
        throw new AppError('UPLOAD_MISMATCH', err.status, err.message);
      }
      throw err;
    }
    res.status(HTTP_STATUS.OK).end();
  });

  router.get('/public/*key', async (req, res) => {
    const segments = (req.params as { key?: string[] }).key ?? [];
    await sendObject(storage, res, 'public', segments.join('/'));
  });

  router.get('/private/:token', async (req, res) => {
    const token = storage.verifyToken(req.params.token);
    if (!token || token.op !== 'get' || token.bucket !== 'private') throw notFound();
    await sendObject(storage, res, 'private', token.key);
  });

  return router;
}
