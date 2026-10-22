import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { CSRF_HEADER } from '@/lib/auth/csrf';

const BFF = '/api/bff';
/** Fired when the server says the session is gone (refresh failed): the app sends the shopper to login. */
export const SIGNED_OUT_EVENT = 'ui:signed-out';

export class BffError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BffError';
  }
}

/** Network failure (offline, server down): no HTTP status. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return undefined;
}

let pendingCsrf: Promise<string> | null = null;

/** CSRF token: the ui_csrf cookie, requested from the server on first use. */
async function csrfToken(): Promise<string> {
  const existing = readCookie(COOKIE_NAMES.csrf);
  if (existing) return existing;
  pendingCsrf ??= fetch(`${BFF}/csrf`, { cache: 'no-store' })
    .then(async (response) => ((await response.json()) as { data: { token: string } }).data.token)
    .finally(() => {
      pendingCsrf = null;
    });
  return pendingCsrf;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export interface BffOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
}

/** JSON call to the website's own BFF. Throws BffError for any non-2xx answer. */
export async function bff<T>(path: string, options: BffOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();

  let response: Response;
  try {
    response = await fetch(`${BFF}/${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new BffError(0, NETWORK_ERROR_CODE, 'Network error');
  }

  if (response.status === 204 || response.status === 202) return undefined as T;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (proxy error page): fall through with the status only.
  }
  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error;
    if (response.status === 401 && error?.code === 'UNAUTHENTICATED') {
      window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT));
    }
    throw new BffError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
    );
  }
  return (body as { data: T }).data;
}
