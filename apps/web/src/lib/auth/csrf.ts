export const CSRF_HEADER = 'x-ui-csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  method: string;
  /** Value of the X-UI-CSRF header. */
  headerToken: string | null;
  /** Value of the ui_csrf cookie. */
  cookieToken: string | undefined;
  /** Origin header (browsers send it on cross-origin and on same-origin POSTs). */
  origin: string | null;
  /** Sec-Fetch-Site header. */
  fetchSite: string | null;
  /** The website's own origin (NEXT_PUBLIC_SITE_URL). */
  siteOrigin: string;
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: 'origin' | 'fetch-site' | 'token' };

/** Constant-time-ish string compare (tokens are random, length is not secret). */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * CSRF check for cookie-authenticated mutations: the request must come from our own origin AND
 * carry the double-submit token (header equals cookie). Safe methods are not checked.
 */
export function verifyCsrf(input: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (input.origin !== null && input.origin !== input.siteOrigin)
    return { ok: false, reason: 'origin' };
  if (input.fetchSite !== null && input.fetchSite !== 'same-origin' && input.fetchSite !== 'none') {
    return { ok: false, reason: 'fetch-site' };
  }
  const { headerToken, cookieToken } = input;
  if (!headerToken || !cookieToken || !same(headerToken, cookieToken))
    return { ok: false, reason: 'token' };
  return { ok: true };
}
