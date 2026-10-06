/**
 * MOCK dashboard data source - the ONLY sample-data file in the admin panel.
 *
 * No dashboard/orders/inventory API exists yet, so nothing here calls the server and no
 * endpoint is assumed. Replace each function body with a real `apiRequest(...)` call when
 * the admin orders/inventory endpoints are built (Phase 7); the hooks in
 * dashboard.queries.ts and every component stay the same.
 *
 * Preview other states with a query parameter on /dashboard:
 *   ?mock=empty   -> no orders, no low stock
 *   ?mock=error   -> every request fails
 */
import type { DashboardSummary, LowStockItem, RecentOrder } from './dashboard.types';

// Typed as boolean (not literal true) so UI checks stay meaningful when this flips.
export const IS_MOCK_DATA: boolean = true;

type MockScenario = 'normal' | 'empty' | 'error';
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 650;
const MS_PER_MINUTE = 60_000;

function scenario(): MockScenario {
  const value = new URLSearchParams(window.location.search).get('mock');
  return value === 'empty' || value === 'error' ? value : 'normal';
}

async function respond<T>(normal: () => T, empty: T): Promise<T> {
  const current = scenario();
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  if (current === 'error') throw new Error('MOCK: simulated failure (?mock=error)');
  return current === 'empty' ? empty : normal();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MS_PER_MINUTE).toISOString();
}

// SAMPLE values: invented names and amounts for layout only.
const SAMPLE_ORDERS: ReadonlyArray<Omit<RecentOrder, 'placedAt'> & { minutesAgo: number }> = [
  {
    id: 'o-1',
    orderNumber: 'UI-100128',
    customerName: 'Adaeze Okafor',
    totalMinor: 8_750_000,
    currency: 'NGN',
    paymentStatus: 'paid',
    orderStatus: 'being_prepared',
    sourceClient: 'ios',
    minutesAgo: 6,
  },
  {
    id: 'o-2',
    orderNumber: 'UI-100127',
    customerName: 'Tunde Bakare',
    totalMinor: 4_200_000,
    currency: 'NGN',
    paymentStatus: 'paid',
    orderStatus: 'being_prepared',
    sourceClient: 'web',
    minutesAgo: 24,
  },
  {
    id: 'o-3',
    orderNumber: 'UI-100126',
    customerName: 'Ngozi Eze',
    totalMinor: 12_500_000,
    currency: 'NGN',
    paymentStatus: 'pending',
    orderStatus: 'pending_payment',
    sourceClient: 'android',
    minutesAgo: 41,
  },
  {
    id: 'o-4',
    orderNumber: 'UI-100125',
    customerName: 'Ibrahim Musa',
    totalMinor: 6_300_000,
    currency: 'NGN',
    paymentStatus: 'paid',
    orderStatus: 'sent_out',
    sourceClient: 'web',
    minutesAgo: 95,
  },
  {
    id: 'o-5',
    orderNumber: 'UI-100124',
    customerName: 'Folake Adeyemi',
    totalMinor: 3_150_000,
    currency: 'NGN',
    paymentStatus: 'failed',
    orderStatus: 'payment_failed',
    sourceClient: 'ios',
    minutesAgo: 180,
  },
  {
    id: 'o-6',
    orderNumber: 'UI-100123',
    customerName: 'Chidi Nwosu',
    totalMinor: 9_900_000,
    currency: 'NGN',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    sourceClient: 'web',
    minutesAgo: 1_440,
  },
];

const SAMPLE_LOW_STOCK: readonly LowStockItem[] = [
  {
    variantId: 'v-1',
    sku: 'UI-AGB-001-M',
    productName: 'Agbada Midnight',
    sizeLabel: 'Medium',
    available: 1,
    lowStockThreshold: 3,
  },
  {
    variantId: 'v-2',
    sku: 'UI-ADR-014-S',
    productName: 'Adire Linen Shirt',
    sizeLabel: 'Small',
    available: 2,
    lowStockThreshold: 3,
  },
  {
    variantId: 'v-3',
    sku: 'UI-ASO-007-XL',
    productName: 'Aso-Oke Trouser',
    sizeLabel: 'Extra Large',
    available: 0,
    lowStockThreshold: 3,
  },
  {
    variantId: 'v-4',
    sku: 'UI-KFT-021-L',
    productName: 'Kaftan Sand',
    sizeLabel: 'Large',
    available: 3,
    lowStockThreshold: 3,
  },
];

export const mockDashboardSource = {
  summary(): Promise<DashboardSummary> {
    return respond<DashboardSummary>(
      () => ({
        ordersToday: 14,
        paidRevenueTodayMinor: 68_450_000,
        currency: 'NGN',
        awaitingProcessing: 5,
        lowStockVariants: SAMPLE_LOW_STOCK.length,
      }),
      {
        ordersToday: 0,
        paidRevenueTodayMinor: 0,
        currency: 'NGN',
        awaitingProcessing: 0,
        lowStockVariants: 0,
      },
    );
  },

  recentOrders(): Promise<RecentOrder[]> {
    return respond<RecentOrder[]>(
      () =>
        SAMPLE_ORDERS.map(({ minutesAgo: age, ...order }) => ({
          ...order,
          placedAt: minutesAgo(age),
        })),
      [],
    );
  },

  lowStock(): Promise<LowStockItem[]> {
    return respond<LowStockItem[]>(() => [...SAMPLE_LOW_STOCK], []);
  },
};
