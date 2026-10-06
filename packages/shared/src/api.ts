import type { ErrorCode } from './error-codes.js';

/** Every error response: `{ error: { code, message, details?, requestId } }`. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/** Single-resource success response. */
export interface ApiData<T> {
  data: T;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Paginated list response. */
export interface ApiList<T> {
  data: T[];
  meta: PageMeta;
}

export interface HealthDto {
  status: 'ok';
  db: 'up';
  uptimeSeconds: number;
  timestamp: string;
}
