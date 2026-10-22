import type { NextRequest, NextResponse } from 'next/server';
import { endSession } from '@/lib/bff/auth-handlers';

export const dynamic = 'force-dynamic';

export function POST(request: NextRequest): Promise<NextResponse> {
  return endSession(request);
}
