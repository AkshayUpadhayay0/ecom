import { serverApiBase } from '@/config/env';

const API_PREFIX = '/api/v1';
const UPSTREAM_TIMEOUT_MS = 15_000;

export interface UpstreamResult {
  status: number;
  /** Raw response body ('' for 204). Parsed by the caller only when it needs to. */
  body: string;
  contentType: string | null;
  /** Value(s) of Set-Cookie sent by the API (the refresh token on login/register). */
  setCookies: string[];
}

export interface UpstreamRequest {
  method: string;
  /** API path below /api/v1, e.g. "auth/login" or "cart/items/123". */
  path: string;
  search?: string;
  json?: unknown;
  accessToken?: string | undefined;
  /** Real client IP (the API rate-limits and locks accounts per IP; run it with TRUST_PROXY=1). */
  clientIp?: string | undefined;
}

/** The API as a server-to-server call. Never forwards the browser's own cookies. */
export async function callApi(request: UpstreamRequest): Promise<UpstreamResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.json !== undefined) headers['Content-Type'] = 'application/json';
  if (request.accessToken) headers.Authorization = `Bearer ${request.accessToken}`;
  if (request.clientIp) headers['X-Forwarded-For'] = request.clientIp;

  const response = await fetch(
    `${serverApiBase()}${API_PREFIX}/${request.path}${request.search ?? ''}`,
    {
      method: request.method,
      headers,
      ...(request.json !== undefined ? { body: JSON.stringify(request.json) } : {}),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    },
  );
  return {
    status: response.status,
    body: response.status === 204 ? '' : await response.text(),
    contentType: response.headers.get('content-type'),
    setCookies: response.headers.getSetCookie(),
  };
}

/** Pulls one cookie value out of the API's Set-Cookie headers. */
export function readSetCookie(setCookies: readonly string[], name: string): string | undefined {
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (pair && eq > 0 && pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return value ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

/** Real client IP from the load balancer's X-Forwarded-For (its last hop), or undefined. */
export function clientIpOf(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').at(-1)?.trim();
    if (last) return last;
  }
  return headers.get('x-real-ip') ?? undefined;
}
