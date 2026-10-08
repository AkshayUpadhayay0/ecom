import type { Request } from 'express';
import { z } from 'zod';

const uuidSchema = z.uuid();

/** Reads a UUID route param (`:id`); a malformed id is a VALIDATION_ERROR, never a SQL error. */
export function uuidParam(req: Request, name = 'id'): string {
  return z.object({ [name]: uuidSchema }).parse(req.params)[name] as string;
}

/** Reads and validates a non-UUID route param with `schema`. */
export function stringParam<T extends z.ZodType<string>>(
  req: Request,
  name: string,
  schema: T,
): z.infer<T> {
  return z.object({ [name]: schema }).parse(req.params)[name] as z.infer<T>;
}
