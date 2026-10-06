import type { ErrorCode } from '@urban-ibile/shared';

/**
 * The only error type services and controllers should throw for expected failures.
 * The central error handler turns it into `{ error: { code, message, details?, requestId } }`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
