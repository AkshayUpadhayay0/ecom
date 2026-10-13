import { useQuery } from '@tanstack/react-query';
import { sizeChartsApi } from '@/lib/api/size-charts';

export const sizeChartKeys = {
  all: ['size-charts'] as const,
  sizes: () => [...sizeChartKeys.all, 'sizes'] as const,
  groups: () => [...sizeChartKeys.all, 'groups'] as const,
  charts: (groupId: string) => [...sizeChartKeys.all, 'groups', groupId, 'charts'] as const,
  chart: (chartId: string) => [...sizeChartKeys.all, 'chart', chartId] as const,
  profiles: () => [...sizeChartKeys.all, 'profiles'] as const,
};

export function useSizes() {
  return useQuery({ queryKey: sizeChartKeys.sizes(), queryFn: sizeChartsApi.sizes });
}

export function useChartGroups() {
  return useQuery({ queryKey: sizeChartKeys.groups(), queryFn: sizeChartsApi.groups });
}

export function useChartVersions(groupId: string | undefined) {
  return useQuery({
    queryKey: sizeChartKeys.charts(groupId ?? ''),
    queryFn: () => sizeChartsApi.charts(groupId ?? ''),
    enabled: groupId !== undefined,
  });
}

export function useChart(chartId: string | undefined) {
  return useQuery({
    queryKey: sizeChartKeys.chart(chartId ?? ''),
    queryFn: () => sizeChartsApi.chart(chartId ?? ''),
    enabled: chartId !== undefined,
  });
}

export function useMeasurementProfiles() {
  return useQuery({ queryKey: sizeChartKeys.profiles(), queryFn: sizeChartsApi.profiles });
}
