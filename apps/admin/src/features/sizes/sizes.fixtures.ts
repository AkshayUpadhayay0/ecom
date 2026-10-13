import type {
  MeasurementProfileDto,
  MeasurementTypeDto,
  SizeChartDto,
  SizeChartGroupDto,
  SizeChartSummaryDto,
  SizeDto,
} from '@urban-ibile/shared';

/*
 * TEST DOUBLES ONLY (used by sizes.test.tsx through MSW). Shapes are the API DTOs from
 * packages/shared; values are copied from db/seeds/seed_0003_charts.sql. The UI itself always
 * reads the real endpoints.
 */

const ACTIVATED = '2026-10-09T10:00:00.000Z';

const mt = (code: string, label: string): MeasurementTypeDto => ({ id: `mt-${code}`, code, label });
const MALE_TOP_TYPES = [
  mt('chest', 'Chest'),
  mt('shoulder', 'Shoulder'),
  mt('sleeve', 'Sleeve'),
  mt('top_length', 'Top length'),
];

export const GROUPS: SizeChartGroupDto[] = [
  {
    id: 'g-female',
    code: 'female',
    name: 'Female',
    audience: 'FEMALE',
    isActive: true,
    measurementTypes: [mt('bust', 'Bust'), mt('waist', 'Waist')],
    activeChart: { id: 'c-female-1', version: 1, activatedAt: ACTIVATED },
  },
  {
    id: 'g-male-top',
    code: 'male_top',
    name: 'Male top - Shirt / Kaftan / Agbada inner',
    audience: 'MALE',
    isActive: true,
    measurementTypes: MALE_TOP_TYPES,
    activeChart: { id: 'c-male-top-2', version: 2, activatedAt: ACTIVATED },
  },
  {
    id: 'g-fila',
    code: 'fila_cap',
    name: 'Fila / cap',
    audience: 'ANY',
    isActive: true,
    measurementTypes: [mt('head_circumference', 'Head circumference')],
    activeChart: null,
  },
];

const summary = (
  id: string,
  groupId: string,
  version: number,
  status: SizeChartSummaryDto['status'],
): SizeChartSummaryDto => ({
  id,
  groupId,
  version,
  name: `Chart v${version}`,
  status,
  boundaryRule: 'SMALLEST_COVERING_SIZE',
  isSampleData: false,
  rowCount: 20,
  effectiveFrom: status === 'draft' ? null : ACTIVATED,
  retiredAt: status === 'retired' ? ACTIVATED : null,
  createdAt: ACTIVATED,
});

export const VERSIONS: Record<string, SizeChartSummaryDto[]> = {
  'g-female': [summary('c-female-1', 'g-female', 1, 'active')],
  'g-male-top': [
    summary('c-male-top-3', 'g-male-top', 3, 'draft'),
    summary('c-male-top-2', 'g-male-top', 2, 'active'),
    summary('c-male-top-1', 'g-male-top', 1, 'retired'),
  ],
  'g-fila': [],
};

const size = (code: string, label: string, sortOrder: number) => ({
  id: `s-${code}`,
  code,
  label,
  sortOrder,
});
const cell = (minInches: number, maxInches: number) => ({ minInches, maxInches });

export const MALE_TOP_CHART: SizeChartDto = {
  ...summary('c-male-top-2', 'g-male-top', 2, 'active'),
  group: { id: 'g-male-top', code: 'male_top', name: GROUPS[1]?.name ?? '' },
  sourceNote: 'Client size-chart images via backend design doc 9 Oct 2026',
  measurementTypes: MALE_TOP_TYPES,
  rows: [
    {
      size: size('M', 'Medium', 2),
      cells: {
        chest: cell(38, 40),
        shoulder: cell(17.5, 18),
        sleeve: cell(24, 25),
        top_length: cell(32, 34),
      },
    },
    {
      size: size('L', 'Large', 3),
      cells: {
        chest: cell(41, 43),
        shoulder: cell(18, 18.5),
        sleeve: cell(25, 26),
        top_length: cell(34, 36),
      },
    },
    {
      size: size('XL', 'Extra Large', 4),
      cells: {
        chest: cell(44, 46),
        shoulder: cell(19, 19.5),
        sleeve: cell(25, 26),
        top_length: null,
      },
    },
  ],
  check: {
    warningCount: 3,
    measurements: [
      {
        measurementType: 'chest',
        gaps: [
          {
            lowerSize: 'M',
            upperSize: 'L',
            fromInches: 40,
            toInches: 41,
            widthInches: 1,
            wholeInchContiguous: true,
          },
        ],
        overlaps: [],
      },
      {
        measurementType: 'sleeve',
        gaps: [],
        overlaps: [
          { lowerSize: 'M', upperSize: 'L', fromInches: 25, toInches: 25 },
          { lowerSize: 'L', upperSize: 'XL', fromInches: 25, toInches: 26 },
        ],
      },
    ],
  },
};

export const FEMALE_CHART: SizeChartDto = {
  ...summary('c-female-1', 'g-female', 1, 'active'),
  group: { id: 'g-female', code: 'female', name: 'Female' },
  sourceNote: null,
  measurementTypes: [mt('bust', 'Bust'), mt('waist', 'Waist')],
  rows: [
    { size: size('XS-6', 'XS (6)', 11), cells: { bust: cell(33, 33), waist: cell(25, 26) } },
    { size: size('S-8', 'S (8)', 12), cells: { bust: cell(36, 36), waist: cell(27, 28) } },
  ],
  check: { warningCount: 0, measurements: [] },
};

export const CHARTS: Record<string, SizeChartDto> = {
  'c-male-top-2': MALE_TOP_CHART,
  'c-female-1': FEMALE_CHART,
};

export const PROFILES: MeasurementProfileDto[] = [
  {
    id: 'p-set',
    code: 'male_top_trouser_set',
    name: 'Male - top + trouser set',
    description: 'One overall size from the largest top or trouser requirement.',
    isActive: true,
    items: [
      {
        chartGroup: { id: 'g-male-top', code: 'male_top', name: 'Male top' },
        measurementType: mt('chest', 'Chest'),
      },
      {
        chartGroup: { id: 'g-male-trouser', code: 'male_trouser', name: 'Male trouser' },
        measurementType: mt('waist', 'Waist'),
      },
    ],
    productCount: 1,
    products: [
      { id: 'prod-1', name: 'Aso Oke Two-Piece', slug: 'aso-oke-two-piece', status: 'active' },
    ],
    productsTruncated: false,
  },
  {
    id: 'p-fila',
    code: 'fila_cap',
    name: 'Fila / cap',
    description: 'Head circumference.',
    isActive: true,
    items: [
      {
        chartGroup: { id: 'g-fila', code: 'fila_cap', name: 'Fila / cap' },
        measurementType: mt('head_circumference', 'Head circumference'),
      },
    ],
    productCount: 0,
    products: [],
    productsTruncated: false,
  },
];

export const SIZES: SizeDto[] = [
  { id: 's-S', code: 'S', label: 'Small', sortOrder: 1, isActive: true },
  { id: 's-M', code: 'M', label: 'Medium', sortOrder: 2, isActive: true },
  { id: 's-XS-6', code: 'XS-6', label: 'XS (6)', sortOrder: 11, isActive: true },
];
