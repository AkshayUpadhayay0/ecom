import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(
    new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, `Route ${req.method} ${req.path} not found.`),
  );
};
