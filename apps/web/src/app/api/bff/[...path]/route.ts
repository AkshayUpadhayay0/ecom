import type { NextRequest, NextResponse } from 'next/server';
import { matchBffPath } from '@/lib/bff/allowlist';
import { csrfGuard, readJson } from '@/lib/bff/guard';
import { errorResponse, forward } from '@/lib/bff/session';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ path: string[] }>;
}

/** One handler for every allow-listed customer API call (see lib/bff/allowlist.ts). */
async function handle(request: NextRequest, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  const apiPath = path.join('/');
  const match = matchBffPath(request.method, apiPath);
  if (!match.allowed) {
    return match.reason === 'method'
      ? errorResponse(405, 'NOT_FOUND', 'Not found.')
      : errorResponse(404, 'NOT_FOUND', 'Not found.');
  }
  const blocked = csrfGuard(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  return forward(request, {
    apiPath,
    search: request.nextUrl.search,
    json: body.json,
    authenticated: match.auth,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
