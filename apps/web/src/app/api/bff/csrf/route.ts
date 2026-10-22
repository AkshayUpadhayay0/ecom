import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, setCsrfCookie } from '@/lib/auth/cookies';

export const dynamic = 'force-dynamic';

const TOKEN_BYTES = 24;

/** Hands the browser its double-submit CSRF token (creates the cookie on first use). */
export function GET(request: NextRequest): NextResponse {
  const existing = request.cookies.get(COOKIE_NAMES.csrf)?.value;
  const token = existing ?? randomBytes(TOKEN_BYTES).toString('base64url');
  const response = NextResponse.json(
    { data: { token } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  if (!existing) setCsrfCookie(response, token);
  return response;
}
