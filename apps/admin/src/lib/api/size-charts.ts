import {
  MAX_PAGE_SIZE,
  type ApiData,
  type ApiList,
  type MeasurementProfileDto,
  type SizeChartDto,
  type SizeChartGroupDto,
  type SizeChartSummaryDto,
  type SizeDto,
} from '@urban-ibile/shared';
import { apiRequest } from './client';

/** Safety stop for reference lists (MAX_PAGES x MAX_PAGE_SIZE rows). */
const MAX_PAGES = 20;

/**
 * Reads every page of a small reference list (sizes, chart groups, versions, profiles).
 * These lists are tens of rows; the API still paginates them, so we follow `meta.totalPages`.
 */
async function fetchAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const { data, meta } = await apiRequest<ApiList<T>>(
      `${path}${separator}page=${page}&pageSize=${MAX_PAGE_SIZE}`,
    );
    items.push(...data);
    if (page >= meta.totalPages) break;
  }
  return items;
}

/** Read-only Size Charts endpoints (apps/api/src/modules/blueprint). */
export const sizeChartsApi = {
  sizes: () => fetchAllPages<SizeDto>('/admin/sizes'),
  groups: () => fetchAllPages<SizeChartGroupDto>('/admin/size-chart-groups'),
  charts: (groupId: string) =>
    fetchAllPages<SizeChartSummaryDto>(`/admin/size-chart-groups/${groupId}/charts`),
  async chart(chartId: string): Promise<SizeChartDto> {
    const { data } = await apiRequest<ApiData<SizeChartDto>>(`/admin/size-charts/${chartId}`);
    return data;
  },
  profiles: () => fetchAllPages<MeasurementProfileDto>('/admin/measurement-profiles'),
};
