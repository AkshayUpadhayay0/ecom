import type { ErrorCode } from '@urban-ibile/shared';
import { HTTP_STATUS } from './http-status.js';

export interface AppErrorOptions {
  /** Extra response headers, e.g. `Retry-After`. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * The only error type services and controllers should throw for expected failures.
 * The central error handler turns it into `{ error: { code, message, details?, requestId } }`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    details?: unknown,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.headers = options.headers ?? {};
  }
}

/** 404 NOT_FOUND for `what` ("Product", "Size"...). */
export function notFoundError(what: string): AppError {
  return new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, `${what} not found.`);
}

/** 409 ALREADY_EXISTS for a unique field (slug, code, sku...). */
export function alreadyExistsError(field: string, message: string): AppError {
  return new AppError('ALREADY_EXISTS', HTTP_STATUS.CONFLICT, message, { field });
}
