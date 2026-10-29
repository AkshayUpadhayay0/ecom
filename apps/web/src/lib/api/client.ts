import { serverApiBase } from '@/config/env';

const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | undefined;

export interface FetchOptions {
  query?: Record<string, QueryValue>;
  /** Seconds Next may reuse the response; 0 = never cache (search with arbitrary text). */
  revalidate: number;
  /** Cache tags, so the API can ask for these responses to be dropped at once (/api/revalidate). */
  tags?: readonly string[];
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${serverApiBase()}${API_PREFIX}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * GET against the public API from a server component. Anything but 2xx throws ApiError so pages
 * decide what a 404 means (notFound) and what is a real failure (error boundary).
 */
export async function apiGet<T>(path: string, options: FetchOptions): Promise<T> {
  const init: RequestInit & { next?: { revalidate: number; tags?: string[] } } = {
    headers: { Accept: 'application/json' },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.revalidate > 0
      ? {
          next: {
            revalidate: options.revalidate,
            ...(options.tags ? { tags: [...options.tags] } : {}),
          },
        }
      : { cache: 'no-store' as const }),
  };
  const response = await fetch(buildUrl(path, options.query), init);
  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // Non-JSON error page (proxy, outage): keep the status only.
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? 'HTTP_ERROR',
      body.error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return (await response.json()) as T;
}
