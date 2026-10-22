import type { NextRequest, NextResponse } from 'next/server';
import { siteOrigin } from '@/config/env';
import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { CSRF_HEADER, verifyCsrf } from '@/lib/auth/csrf';
import { errorResponse } from './session';

/** null when the request may proceed, otherwise the 403 to return. */
export function csrfGuard(request: NextRequest): NextResponse | null {
  const verdict = verifyCsrf({
    method: request.method,
    headerToken: request.headers.get(CSRF_HEADER),
    cookieToken: request.cookies.get(COOKIE_NAMES.csrf)?.value,
    origin: request.headers.get('origin'),
    fetchSite: request.headers.get('sec-fetch-site'),
    siteOrigin: siteOrigin(),
  });
  return verdict.ok ? null : errorResponse(403, 'FORBIDDEN', 'This request could not be verified.');
}

const MAX_BODY_BYTES = 64 * 1024;

export type JsonBody = { ok: true; json: unknown } | { ok: false; response: NextResponse };

/** Reads an optional JSON body (size-limited). An empty body is `undefined`. */
export async function readJson(request: NextRequest): Promise<JsonBody> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, 'VALIDATION_ERROR', 'Request too large.') };
  }
  if (text === '') return { ok: true, json: undefined };
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_ERROR', 'Invalid request.') };
  }
}
