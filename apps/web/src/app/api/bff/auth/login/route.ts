import type { NextRequest, NextResponse } from 'next/server';
import { startSession } from '@/lib/bff/auth-handlers';

export const dynamic = 'force-dynamic';

export function POST(request: NextRequest): Promise<NextResponse> {
  return startSession(request, 'auth/login');
}
