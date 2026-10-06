import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '@urban-ibile/shared';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { HTTP_STATUS } from '../lib/http-status.js';

/** Shape of errors raised by Express's built-in body parsers. */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    'status' in err &&
    typeof err.status === 'number'
  );
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Request validation failed.', {
      issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      return new AppError('VALIDATION_ERROR', HTTP_STATUS.BAD_REQUEST, 'Malformed JSON body.');
    }
    if (err.type === 'entity.too.large') {
      return new AppError(
        'VALIDATION_ERROR',
        HTTP_STATUS.PAYLOAD_TOO_LARGE,
        'Request body too large.',
      );
    }
  }

  return new AppError('INTERNAL_ERROR', HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Something went wrong.');
}

/**
 * Central error handler. Every error leaves the API as
 * `{ error: { code, message, details?, requestId } }`. Unexpected errors are logged with the
 * request id; their stack traces and messages are never sent to the client.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const appError = toAppError(err);
  // genReqId (request-logger.ts) always assigns a string id.
  const requestId = typeof req.id === 'string' ? req.id : 'unknown';

  if (appError.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    req.log.error({ err, requestId }, appError.message);
  } else {
    req.log.warn({ code: appError.code, requestId }, appError.message);
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      requestId,
    },
  };
  res.status(appError.status).json(body);
};
