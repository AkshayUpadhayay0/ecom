import { useQuery } from '@tanstack/react-query';
import type {
  AdminOrderSummaryDto,
  LowStockVariantDto,
  StatsOverviewDto,
} from '@urban-ibile/shared';
import { getData, getList } from '@/lib/api/http';

const RECENT_ORDERS = 5;
const LOW_STOCK_ROWS = 6;

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  recentOrders: () => [...dashboardKeys.all, 'recent-orders'] as const,
  lowStock: () => [...dashboardKeys.all, 'low-stock'] as const,
};

/** GET /admin/stats/overview (real counts; the API caches them briefly). */
export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => getData<StatsOverviewDto>('/admin/stats/overview'),
  });
}

export function useRecentOrders() {
  return useQuery({
    queryKey: dashboardKeys.recentOrders(),
    queryFn: async () =>
      (await getList<AdminOrderSummaryDto>('/admin/orders', { pageSize: RECENT_ORDERS })).data,
  });
}

export function useLowStock() {
  return useQuery({
    queryKey: dashboardKeys.lowStock(),
    queryFn: async () =>
      (
        await getList<LowStockVariantDto>('/admin/inventory/low-stock', {
          pageSize: LOW_STOCK_ROWS,
        })
      ).data,
  });
}
