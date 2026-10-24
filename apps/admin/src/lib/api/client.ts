import type { ApiErrorBody, ErrorCode } from '@urban-ibile/shared';
import { resolveApiBaseUrl } from './config';

/** Client-side codes for failures that never reached the API's error handler. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE' | 'UPLOAD_FAILED';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(
    code: ClientErrorCode,
    status: number,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_MODIFIED = 304;
const REFRESH_PATH = '/admin/auth/refresh';
/** Web Locks name: serialises refreshes across tabs (see refreshAccessToken). */
const REFRESH_LOCK = 'urban-ibile-admin-refresh';

// ---------------------------------------------------------------- session state (memory only)

/**
 * The access token lives ONLY in this module's memory (never localStorage/sessionStorage).
 * The refresh token is an httpOnly cookie set by the API; JavaScript cannot read it.
 */
let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export const session = {
  setAccessToken(token: string | null): void {
    accessToken = token;
  },
  hasAccessToken(): boolean {
    return accessToken !== null;
  },
  clear(): void {
    accessToken = null;
  },
  /** Called when a request is rejected and the session cannot be refreshed. */
  onExpired(handler: (() => void) | null): void {
    sessionExpiredHandler = handler;
  },
};

// ---------------------------------------------------------------- errors

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isApiErrorBody(body)) {
    const { code, message, details, requestId } = body.error;
    return new ApiError(code, response.status, message, details, requestId);
  }
  return new ApiError(
    'UNEXPECTED_RESPONSE',
    response.status,
    `Unexpected response from the server (HTTP ${response.status}).`,
  );
}

// ---------------------------------------------------------------- transport

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Raw text body (e.g. a CSV upload) instead of JSON. */
  text?: { content: string; contentType: string };
  /** Send the access token and refresh on 401 (default true). */
  auth?: boolean;
  signal?: AbortSignal;
  /** Browser cache mode; default 'no-store' (private data is never cached or revalidated). */
  cache?: RequestCache;
  /** Appended as a cache-busting query parameter (last resort after a stray 304). */
  bust?: boolean;
}

/** Where a request that could not be delivered was going (shown to help find the cause). */
function describeNetworkFailure(): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You appear to be offline. Check your internet connection and try again.';
  }
  let where = 'the API';
  try {
    where = `the API at ${new URL(resolveApiBaseUrl()).origin}`;
  } catch {
    // keep the generic wording
  }
  return `Cannot reach the server (${where}). It may be restarting or not running. If it keeps happening, ask a developer to check that the API is up and that this site's address is allowed by its CORS_ORIGINS setting.`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.text !== undefined) headers['Content-Type'] = options.text.contentType;
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && accessToken !== null) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const url = `${resolveApiBaseUrl()}${path}${options.bust ? `${path.includes('?') ? '&' : '?'}_nc=${Date.now()}` : ''}`;
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.text !== undefined
          ? options.text.content
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      // Required so the browser sends/stores the httpOnly refresh cookie.
      credentials: 'include',
      cache: options.cache ?? 'no-store',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('NETWORK_ERROR', 0, describeNetworkFailure());
  }
}

/**
 * "304 Not Modified" has no body and is not an error. It should never reach the app (the API sends
 * private answers with no-store and no ETag, and this client sends no-store), but a stale cache,
 * proxy or extension can still produce one. Ask again, bypassing every cache, instead of failing.
 */
async function sendAvoiding304(path: string, options: RequestOptions): Promise<Response> {
  let response = await send(path, options);
  if (response.status !== HTTP_NOT_MODIFIED) return response;
  response = await send(path, { ...options, cache: 'reload' });
  if (response.status !== HTTP_NOT_MODIFIED) return response;
  return send(path, { ...options, cache: 'reload', bust: true });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === HTTP_NOT_MODIFIED) {
    throw new ApiError(
      'UNEXPECTED_RESPONSE',
      response.status,
      'The server answered "not modified" without any data. Reload the page; if it keeps happening, tell a developer.',
    );
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === HTTP_NO_CONTENT) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------- refresh

async function performRefresh(): Promise<boolean> {
  try {
    const response = await send(REFRESH_PATH, { method: 'POST', auth: false });
    if (!response.ok) {
      accessToken = null;
      return false;
    }
    const body = (await response.json()) as { data: { tokens: { accessToken: string } } };
    accessToken = body.data.tokens.accessToken;
    return true;
  } catch {
    accessToken = null;
    return false;
  }
}

/**
 * Exchanges the refresh cookie for a new access token. Returns false if there is no valid
 * session.
 *
 * The API rotates the refresh token on every use and treats a replayed token as theft
 * (revoking the session). So refreshes must never overlap:
 *  - within a tab, concurrent callers share one in-flight promise;
 *  - across tabs, the Web Locks API serialises them, so the next tab sends the cookie the
 *    previous refresh already rotated.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      return locks
        ? await locks.request(REFRESH_LOCK, () => performRefresh())
        : await performRefresh();
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// ---------------------------------------------------------------- public API

/**
 * JSON request against the API. On 401 (for authenticated calls) it refreshes once and
 * retries once; if that fails the session is cleared and the expiry handler runs.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await sendAvoiding304(path, options);
  if (response.status !== HTTP_UNAUTHORIZED || options.auth === false) {
    return parse<T>(response);
  }

  if (await refreshAccessToken()) {
    const retried = await sendAvoiding304(path, options);
    if (retried.status !== HTTP_UNAUTHORIZED) return parse<T>(retried);
  }

  accessToken = null;
  sessionExpiredHandler?.();
  throw await toApiError(response);
}
