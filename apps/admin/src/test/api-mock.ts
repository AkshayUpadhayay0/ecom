import type { AdminDto, ErrorCode, StatsOverviewDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Mirrors apps/api admin auth responses (contract test double). */
export const API = 'http://localhost:4000/api/v1';

export const TEST_ADMIN: AdminDto = {
  id: '6f1c2a54-0000-4000-8000-000000000001',
  email: 'boss@example.com',
  displayName: 'Bisi Adewale',
  role: 'super_admin',
  mustChangePassword: false,
};
export const VALID_PASSWORD = 'Ankara-Velvet-2026!';
export const LOCKED_EMAIL = 'locked@example.com';
export const RATE_LIMITED_EMAIL = 'limited@example.com';
export const LOCK_SECONDS = 600;

/** Simulated server-side state: `hasSession` stands in for the httpOnly refresh cookie. */
export const apiState = {
  hasSession: false,
  /** Role of the signed-in admin (role-aware UI tests switch it to 'admin'). */
  role: 'super_admin' as AdminDto['role'],
  currentAccessToken: 'access-0',
  issued: 0,
  loginCalls: 0,
  refreshCalls: 0,
  reset(): void {
    this.hasSession = false;
    this.role = 'super_admin';
    this.currentAccessToken = 'access-0';
    this.issued = 0;
    this.loginCalls = 0;
    this.refreshCalls = 0;
  },
};

function currentAdmin(): AdminDto {
  return { ...TEST_ADMIN, role: apiState.role };
}

export function errorResponse(status: number, code: ErrorCode, message: string, details?: unknown) {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: 'req-test',
      },
    },
    { status },
  );
}

function issueTokens() {
  apiState.issued += 1;
  apiState.currentAccessToken = `access-${apiState.issued}`;
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  return {
    accessToken: apiState.currentAccessToken,
    accessTokenExpiresAt: inMinutes(15),
    refreshTokenExpiresAt: inMinutes(720),
  };
}

export const handlers = [
  http.post(`${API}/admin/auth/login`, async ({ request }) => {
    apiState.loginCalls += 1;
    const body = (await request.json()) as { email?: string; password?: string };
    if (body.email === LOCKED_EMAIL) {
      return errorResponse(429, 'ACCOUNT_LOCKED', 'Too many failed sign-in attempts.', {
        retryAfterSeconds: LOCK_SECONDS,
      });
    }
    if (body.email === RATE_LIMITED_EMAIL) {
      return errorResponse(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
    }
    if (body.email !== TEST_ADMIN.email || body.password !== VALID_PASSWORD) {
      return errorResponse(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }
    apiState.hasSession = true;
    return HttpResponse.json({ data: { admin: currentAdmin(), tokens: issueTokens() } });
  }),

  http.post(`${API}/admin/auth/refresh`, () => {
    apiState.refreshCalls += 1;
    if (!apiState.hasSession) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in again.');
    return HttpResponse.json({ data: { tokens: issueTokens() } });
  }),

  http.get(`${API}/admin/auth/me`, ({ request }) => {
    const auth = request.headers.get('authorization');
    if (!apiState.hasSession || auth !== `Bearer ${apiState.currentAccessToken}`) {
      return errorResponse(401, 'TOKEN_EXPIRED', 'Access token expired.');
    }
    return HttpResponse.json({ data: currentAdmin() });
  }),

  http.post(`${API}/admin/auth/logout`, () => {
    apiState.hasSession = false;
    return new HttpResponse(null, { status: 204 });
  }),

  // Dashboard contract doubles (empty shop). Feature tests override these with server.use().
  http.get(`${API}/admin/stats/overview`, () => HttpResponse.json({ data: EMPTY_STATS })),
  http.get(`${API}/admin/orders`, () => HttpResponse.json(emptyList())),
  http.get(`${API}/admin/inventory/low-stock`, () => HttpResponse.json(emptyList())),
];

export function emptyList() {
  return { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
}

export function listOf<T>(data: T[], page = 1, totalPages = 1) {
  return { data, meta: { page, pageSize: 20, total: data.length, totalPages } };
}

/** GET /admin/stats/overview for a shop with no activity. */
export const EMPTY_STATS: StatsOverviewDto = {
  generatedAt: '2026-10-16T09:00:00.000Z',
  currency: 'NGN',
  ordersByStatus: {},
  paid: {
    today: { orders: 0, revenueMinor: 0 },
    last7Days: { orders: 0, revenueMinor: 0 },
    last30Days: { orders: 0, revenueMinor: 0 },
  },
  ordersNeedingAttention: 0,
  paymentsNeedingReview: 0,
  lowStockVariants: 0,
  outOfStockVariants: 0,
  failedMediaJobs: 0,
  openReturns: 0,
  returnsAwaitingAction: 0,
};

export const server = setupServer(...handlers);
