import type { ApiData, ApiList } from '@urban-ibile/shared';
import { apiRequest } from './client';

type QueryValue = string | number | boolean | null | undefined;

/** `{ a: 1, b: undefined, c: '' }` -> `?a=1` (empty values are dropped). */
export function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** GET returning `{ data }`. */
export async function getData<T>(path: string): Promise<T> {
  return (await apiRequest<ApiData<T>>(path)).data;
}

/** GET returning `{ data: [...], meta }` (paginated lists). */
export function getList<T>(
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<ApiList<T>> {
  return apiRequest<ApiList<T>>(`${path}${toQueryString(params)}`);
}

/** Write returning `{ data }`. */
export async function send<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const result = await apiRequest<ApiData<T> | undefined>(path, {
    method,
    ...(body !== undefined && { body }),
  });
  return result?.data as T;
}
