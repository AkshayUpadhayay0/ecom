import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { decideRevalidation } from './handler';

// Called by the API server to server (never by a browser): see apps/api/src/lib/web-revalidate.ts.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Not JSON: decideRevalidation answers 400 (or 401/404 first).
  }
  const result = decideRevalidation(
    process.env.REVALIDATE_SECRET,
    request.headers.get('authorization'),
    body,
  );
  if (result.status === 200) {
    // expire: 0 = the next visit waits for fresh data instead of being served stale.
    for (const tag of result.body.revalidated ?? []) revalidateTag(tag, { expire: 0 });
  }
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
