import { useQuery } from '@tanstack/react-query';
import { mockDashboardSource } from './dashboard.mock';

/** Swap `source` for the real API client when the endpoints exist; hooks stay the same. */
const source = mockDashboardSource;

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
  recentOrders: () => [...dashboardKeys.all, 'recent-orders'] as const,
  lowStock: () => [...dashboardKeys.all, 'low-stock'] as const,
};

export function useDashboardSummary() {
  return useQuery({ queryKey: dashboardKeys.summary(), queryFn: () => source.summary() });
}

export function useRecentOrders() {
  return useQuery({ queryKey: dashboardKeys.recentOrders(), queryFn: () => source.recentOrders() });
}

export function useLowStock() {
  return useQuery({ queryKey: dashboardKeys.lowStock(), queryFn: () => source.lowStock() });
}
