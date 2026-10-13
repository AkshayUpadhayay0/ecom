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

/** Uncovered range between two consecutive sizes (in sort order). */
export interface SizeChartGapDto {
  lowerSize: string;
  upperSize: string;
  /** Exclusive bounds: values strictly between these are covered by no size. */
  fromInches: number;
  toInches: number;
  widthInches: number;
  /**
   * True when both bounds are whole inches one inch apart (e.g. 40 then 41), i.e. the ranges
   * touch when the chart is read in whole inches. Shown so reviewers can judge; nothing is changed.
   */
  wholeInchContiguous: boolean;
}

/** Range covered by two consecutive sizes at once. */
export interface SizeChartOverlapDto {
  lowerSize: string;
  upperSize: string;
  fromInches: number;
  toInches: number;
}

export interface SizeChartMeasurementCheckDto {
  measurementType: string;
  gaps: SizeChartGapDto[];
  overlaps: SizeChartOverlapDto[];
}

/**
 * Review WARNINGS only. Blueprint resolves both cases with the chart's boundary rule
 * (SMALLEST_COVERING_SIZE): a value in a gap maps to the next size up; a value in an overlap maps
 * to the smaller size. The tailor decides whether the chart itself should change.
 */
export interface SizeChartCheckDto {
  warningCount: number;
  measurements: SizeChartMeasurementCheckDto[];
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
