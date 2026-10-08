import type { Request, Response } from 'express';
import type { ApiData, ApiList } from '@urban-ibile/shared';
import { HTTP_STATUS } from './http-status.js';
import type { Page } from './pagination.js';

/** Request body for Zod parsing (`{}` when the client sent none). */
export function bodyOf(req: Request): unknown {
  return req.body ?? {};
}

/** `{ data }` */
export function sendData(res: Response, status: number, data: unknown): void {
  const body: ApiData<unknown> = { data };
  res.status(status).json(body);
}

/** `{ data: [...], meta }` */
export function sendPage<T>(res: Response, page: Page<T>): void {
  const body: ApiList<T> = { data: page.items, meta: page.meta };
  res.status(HTTP_STATUS.OK).json(body);
}
