import { paginationQuerySchema } from './admin-common.js';

/*
 * Read-only Size Charts viewer (admin). Charts and profiles are loaded by developers; editing and
 * versioning come with the Blueprint phase. All values are INCHES.
 */

export const listSizeChartGroupsQuerySchema = paginationQuerySchema;
export const listSizeChartsQuerySchema = paginationQuerySchema;
export const listMeasurementProfilesQuerySchema = paginationQuerySchema;

export type SizeChartStatus = 'draft' | 'active' | 'retired';

export interface MeasurementTypeDto {
  id: string;
  code: string;
  label: string;
}

export interface SizeChartGroupDto {
  id: string;
  code: string;
  name: string;
  audience: 'FEMALE' | 'MALE' | 'ANY';
  isActive: boolean;
  /** Measurements every chart of this group must define, in display order. */
  measurementTypes: MeasurementTypeDto[];
  /** null when the group has no active chart. */
  activeChart: { id: string; version: number; activatedAt: string | null } | null;
}

export interface SizeChartSummaryDto {
  id: string;
  groupId: string;
  version: number;
  name: string;
  status: SizeChartStatus;
  boundaryRule: string;
  isSampleData: boolean;
  rowCount: number;
  effectiveFrom: string | null;
  retiredAt: string | null;
  createdAt: string;
}

export interface SizeChartCellDto {
  minInches: number;
  maxInches: number;
}

export interface SizeChartGridRowDto {
  size: { id: string; code: string; label: string; sortOrder: number };
  /** Keyed by measurement type code; null where the chart has no value. */
  cells: Record<string, SizeChartCellDto | null>;
}

export const SIZE_CHART_CHECK_CODES = [
  'MAX_NOT_INCREASING',
  'MAX_TIE',
  'MISSING_CELL',
  'UPPER_LIMIT',
] as const;
export type SizeChartCheckCode = (typeof SIZE_CHART_CHECK_CODES)[number];

/** warning: likely chart error; notice: worth a look; info: context, never counted. */
export type SizeChartCheckSeverity = 'warning' | 'notice' | 'info';

/**
 * One finding of the chart check. Blueprint matches each measurement to the SMALLEST size whose
 * max_inches >= value (SMALLEST_COVERING_SIZE), so only max values matter here; min values are
 * informational and gaps/overlaps between ranges are not findings.
 */
export interface SizeChartCheckItemDto {
  code: SizeChartCheckCode;
  severity: SizeChartCheckSeverity;
  measurementType: string;
  /** Sizes involved, in sizes.sort_order. */
  sizes: string[];
  /** The max values involved (empty for MISSING_CELL). */
  values: { size: string; maxInches: number }[];
  message: string;
}

/** Review findings only: nothing in the chart is changed. */
export interface SizeChartCheckDto {
  warningCount: number;
  noticeCount: number;
  infoCount: number;
  items: SizeChartCheckItemDto[];
}

export interface SizeChartDto extends SizeChartSummaryDto {
  group: { id: string; code: string; name: string };
  sourceNote: string | null;
  /** Columns, in the group's display order. */
  measurementTypes: MeasurementTypeDto[];
  /** Rows, ordered by sizes.sort_order. */
  rows: SizeChartGridRowDto[];
  check: SizeChartCheckDto;
}

export interface MeasurementProfileItemDto {
  chartGroup: { id: string; code: string; name: string };
  measurementType: MeasurementTypeDto;
}

export interface MeasurementProfileDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  items: MeasurementProfileItemDto[];
  productCount: number;
  /** First products using the profile; the full list is GET /admin/products?measurementProfileId=. */
  products: { id: string; name: string; slug: string; status: string }[];
  productsTruncated: boolean;
}
