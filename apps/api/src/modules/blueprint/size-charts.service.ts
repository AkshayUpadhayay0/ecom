import type {
  MeasurementProfileDto,
  PaginationQuery,
  SizeChartDto,
  SizeChartGridRowDto,
  SizeChartGroupDto,
  SizeChartStatus,
  SizeChartSummaryDto,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import type { SettingsService } from '../settings/settings.service.js';
import { checkChart, type CheckCell } from './chart-check.js';
import type { ChartRow, GroupRow, SizeChartsRepository } from './size-charts.repository.js';

/** Products shown per profile in the profiles list (the full list is the products endpoint). */
export const PROFILE_PRODUCTS_PREVIEW = 50;

/** Read-only Size Charts viewer. Nothing here writes; charts change in the Blueprint phase. */
export interface SizeChartsService {
  listGroups(query: PaginationQuery): Promise<Page<SizeChartGroupDto>>;
  listCharts(groupId: string, query: PaginationQuery): Promise<Page<SizeChartSummaryDto>>;
  /** Full grid plus review warnings (gaps / overlaps); never adjusts data. */
  getChart(chartId: string): Promise<SizeChartDto>;
  listProfiles(query: PaginationQuery): Promise<Page<MeasurementProfileDto>>;
}

export interface SizeChartsServiceDeps {
  db: Database;
  repository: SizeChartsRepository;
  settings: SettingsService;
}

// Values are CHECK-constrained in the database.
const asAudience = (value: string) => value as SizeChartGroupDto['audience'];
const asStatus = (value: string) => value as SizeChartStatus;

function toSummary(row: ChartRow): SizeChartSummaryDto {
  return {
    id: row.id,
    groupId: row.groupId,
    version: row.version,
    name: row.name,
    status: asStatus(row.status),
    boundaryRule: row.boundaryRule,
    isSampleData: row.isSampleData,
    rowCount: row.rowCount,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function activeChartOf(row: GroupRow): SizeChartGroupDto['activeChart'] {
  if (row.activeChartId === null || row.activeChartVersion === null) return null;
  return {
    id: row.activeChartId,
    version: row.activeChartVersion,
    activatedAt: row.activeChartEffectiveFrom?.toISOString() ?? null,
  };
}

export function createSizeChartsService({
  db,
  repository,
  settings,
}: SizeChartsServiceDeps): SizeChartsService {
  async function pageRequest(query: PaginationQuery) {
    return toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
  }

  return {
    async listGroups(query) {
      const page = await pageRequest(query);
      const { rows, total } = await repository.listGroups(db, page);
      const measurements = await repository.groupMeasurements(
        db,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          audience: asAudience(row.audience),
          isActive: row.isActive,
          measurementTypes: measurements.get(row.id) ?? [],
          activeChart: activeChartOf(row),
        })),
        meta: toPageMeta(page, total),
      };
    },

    async listCharts(groupId, query) {
      if (!(await repository.groupExists(db, groupId))) throw notFoundError('Size chart group');
      const page = await pageRequest(query);
      const { rows, total } = await repository.listCharts(db, groupId, page);
      return { items: rows.map(toSummary), meta: toPageMeta(page, total) };
    },

    async getChart(chartId) {
      const chart = await repository.findChart(db, chartId);
      if (!chart) throw notFoundError('Size chart');
      const [cells, measurements] = await Promise.all([
        repository.chartCells(db, chartId),
        repository.groupMeasurements(db, [chart.groupId]),
      ]);
      const columns = measurements.get(chart.groupId) ?? [];

      const rowsBySize = new Map<string, SizeChartGridRowDto>();
      const checkColumns = new Map<string, CheckCell[]>(columns.map((m) => [m.code, []]));
      for (const cell of cells) {
        let row = rowsBySize.get(cell.sizeId);
        if (!row) {
          row = {
            size: {
              id: cell.sizeId,
              code: cell.sizeCode,
              label: cell.sizeLabel,
              sortOrder: cell.sortOrder,
            },
            cells: Object.fromEntries(columns.map((m) => [m.code, null])),
          };
          rowsBySize.set(cell.sizeId, row);
        }
        const minInches = Number(cell.minInches);
        const maxInches = Number(cell.maxInches);
        row.cells[cell.measurementCode] = { minInches, maxInches };
        checkColumns.get(cell.measurementCode)?.push({
          sizeCode: cell.sizeCode,
          sortOrder: cell.sortOrder,
          minInches,
          maxInches,
        });
      }

      return {
        ...toSummary(chart),
        group: { id: chart.groupId, code: chart.groupCode, name: chart.groupName },
        sourceNote: chart.sourceNote,
        measurementTypes: columns,
        // Cells arrive ordered by sizes.sort_order, so insertion order is the row order.
        rows: [...rowsBySize.values()],
        check: checkChart(checkColumns),
      };
    },

    async listProfiles(query) {
      const page = await pageRequest(query);
      const { rows, total } = await repository.listProfiles(db, page);
      const ids = rows.map((row) => row.id);
      const [items, counts, products] = await Promise.all([
        repository.profileItems(db, ids),
        repository.profileProductCounts(db, ids),
        repository.profileProducts(db, ids, PROFILE_PRODUCTS_PREVIEW),
      ]);
      return {
        items: rows.map((row) => {
          const productCount = counts.get(row.id) ?? 0;
          return {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            isActive: row.isActive,
            items: items
              .filter((item) => item.profileId === row.id)
              .map((item) => ({
                chartGroup: { id: item.groupId, code: item.groupCode, name: item.groupName },
                measurementType: {
                  id: item.measurementTypeId,
                  code: item.measurementCode,
                  label: item.measurementLabel,
                },
              })),
            productCount,
            products: products
              .filter((product) => product.profileId === row.id)
              .map(({ id, name, slug, status }) => ({ id, name, slug, status })),
            productsTruncated: productCount > PROFILE_PRODUCTS_PREVIEW,
          };
        }),
        meta: toPageMeta(page, total),
      };
    },
  };
}
