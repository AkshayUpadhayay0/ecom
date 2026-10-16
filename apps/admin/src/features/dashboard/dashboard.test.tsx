import { screen, within } from '@testing-library/react';
import type {
  AdminOrderSummaryDto,
  LowStockVariantDto,
  StatsOverviewDto,
} from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, EMPTY_STATS, apiState, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const STATS: StatsOverviewDto = {
  ...EMPTY_STATS,
  ordersByStatus: { being_prepared: 3, payment_review: 1 },
  paid: {
    today: { orders: 2, revenueMinor: 3_500_000 },
    last7Days: { orders: 6, revenueMinor: 9_800_000 },
    last30Days: { orders: 20, revenueMinor: 31_000_000 },
  },
  ordersNeedingAttention: 1,
  paymentsNeedingReview: 2,
  lowStockVariants: 4,
  outOfStockVariants: 1,
  failedMediaJobs: 5,
  openReturns: 7,
  returnsAwaitingAction: 3,
};

const ORDER: AdminOrderSummaryDto = {
  id: 'o-1',
  orderNumber: 'UI-100777',
  orderStatus: 'being_prepared',
  paymentStatus: 'paid',
  needsAttention: false,
  customer: { id: 'c-1', fullName: 'Chidi Okafor', email: 'chidi@example.com' },
  recipientName: 'Chidi Okafor',
  contactPhone: '+2348012345678',
  deliveryZoneName: 'Lagos',
  currency: 'NGN',
  totalMinor: 1_750_000,
  itemCount: 1,
  placedAt: '2026-10-16T08:00:00.000Z',
  paidAt: '2026-10-16T08:01:00.000Z',
};

const LOW: LowStockVariantDto = {
  id: 'v-1',
  productId: 'p-1',
  size: { id: 's-1', code: 'L', label: 'Large' },
  sku: 'FIT-KAFTAN-L',
  stockOnHand: 0,
  stockReserved: 0,
  stockAvailable: 0,
  lowStockThreshold: 3,
  isLowStock: true,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  product: { id: 'p-1', name: 'Fit Kaftan', slug: 'fit-kaftan', status: 'active' },
};

beforeEach(() => {
  apiState.hasSession = true;
});

describe('dashboard (real API data only)', () => {
  it('shows the stats endpoint numbers and links every tile to its filtered list', async () => {
    server.use(
      http.get(`${API}/admin/stats/overview`, () => HttpResponse.json({ data: STATS })),
      http.get(`${API}/admin/orders`, () => HttpResponse.json(listOf([ORDER]))),
      http.get(`${API}/admin/inventory/low-stock`, () => HttpResponse.json(listOf([LOW]))),
    );
    renderApp('/dashboard');
    const tiles = await screen.findByRole('region', { name: 'Today at a glance' });
    const link = (name: RegExp) => within(tiles).getByRole('link', { name });
    expect(
      await within(tiles).findByRole('link', { name: /Paid today: ₦35,000\.00/ }),
    ).toHaveAttribute('href', '/orders?paymentStatus=paid');
    expect(link(/Being prepared: 3/)).toHaveAttribute('href', '/orders?orderStatus=being_prepared');
    expect(link(/Orders needing attention: 1/)).toHaveAttribute(
      'href',
      '/orders?needsAttention=true',
    );
    expect(link(/Payments to review: 2/)).toHaveAttribute('href', '/payment-reviews');
    expect(link(/Open returns: 7. 3 waiting/)).toHaveAttribute('href', '/returns?open=true');
    expect(link(/Low \/ out of stock: 4 \/ 1/)).toHaveAttribute('href', '/inventory');
    expect(link(/Failed media jobs: 5/)).toHaveAttribute('href', '/media?status=failed');

    expect(await screen.findByRole('link', { name: 'UI-100777' })).toHaveAttribute(
      'href',
      '/orders/o-1',
    );
    expect(screen.getByText('Chidi Okafor')).toBeInTheDocument();
    expect(screen.getByText('Fit Kaftan')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.queryByText(/sample/i)).not.toBeInTheDocument();
  });

  it('shows zeros and empty states for a new shop, and an error state when the API fails', async () => {
    renderApp('/dashboard');
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByText('Stock looks healthy')).toBeInTheDocument();
  });

  it('shows a retryable error when the stats request fails', { timeout: 15_000 }, async () => {
    server.use(
      http.get(`${API}/admin/stats/overview`, () => errorResponse(500, 'INTERNAL_ERROR', 'Boom')),
    );
    renderApp('/dashboard');
    // Server errors are retried twice (with backoff) before the error state shows.
    expect(
      await screen.findByText(/Couldn’t load the dashboard numbers/, undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
  });
});
