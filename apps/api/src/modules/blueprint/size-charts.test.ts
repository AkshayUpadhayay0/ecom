import type {
  ApiData,
  ApiList,
  MeasurementProfileDto,
  SizeChartDto,
  SizeChartGroupDto,
  SizeChartSummaryDto,
  SizeDto,
} from '@urban-ibile/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  errorCode,
  resetAdminApiData,
  seededClothingTypeId,
  seededProfileId,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
/** Female chart: 8 sizes x 6 measurements (seed_0003_charts.sql). */
const FEMALE_CHART_CELLS = 8 * 6;

describe.skipIf(!hasTestDatabase)('admin size charts viewer (read-only)', () => {
  let ctx: TestContext;
  let api: AdminClient;
  let groups: SizeChartGroupDto[];

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    // Internal tool (19 Oct 2026): chart grids are super_admin only.
    api = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
    groups = bodyOf<ApiList<SizeChartGroupDto>>(await api.get('/size-chart-groups')).data;
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  function group(code: string): SizeChartGroupDto {
    const found = groups.find((g) => g.code === code);
    if (!found) throw new Error(`group ${code} not seeded`);
    return found;
  }

  async function activeChart(code: string): Promise<SizeChartDto> {
    const res = await api.get(`/size-charts/${group(code).activeChart?.id ?? ''}`);
    expect(res.status).toBe(200);
    return bodyOf<ApiData<SizeChartDto>>(res).data;
  }

  it('lists the chart groups with required measurements and the active version', async () => {
    expect(groups.map((g) => g.code)).toEqual([
      'female',
      'male_top',
      'male_trouser',
      'agbada_body',
      'fila_cap',
    ]);
    expect(group('male_top').measurementTypes.map((m) => m.code)).toEqual([
      'chest',
      'shoulder',
      'sleeve',
      'top_length',
    ]);
    expect(group('male_top').activeChart?.version).toBe(1);
    expect(group('male_top').activeChart?.activatedAt).toEqual(expect.any(String));

    const charts = await api.get(`/size-chart-groups/${group('female').id}/charts`);
    const list = bodyOf<ApiList<SizeChartSummaryDto>>(charts);
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({
      version: 1,
      status: 'active',
      rowCount: FEMALE_CHART_CELLS,
    });
  });

  it('returns the male_top grid with the seeded chest values, rows in sizes.sort_order', async () => {
    const chart = await activeChart('male_top');
    expect(chart.measurementTypes.map((m) => m.code)).toEqual([
      'chest',
      'shoulder',
      'sleeve',
      'top_length',
    ]);
    expect(chart.rows.map((r) => r.size.code)).toEqual(['M', 'L', 'XL', 'XXL', '3XL']);
    expect(chart.rows.map((r) => r.cells.chest)).toEqual([
      { minInches: 38, maxInches: 40 },
      { minInches: 41, maxInches: 43 },
      { minInches: 44, maxInches: 46 },
      { minInches: 47, maxInches: 49 },
      { minInches: 50, maxInches: 53 },
    ]);
    const sortOrders = chart.rows.map((r) => r.size.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  it('reports max-based findings: female length ties, no bust/chest warnings, an upper limit per measurement', async () => {
    const female = await activeChart('female');
    const codesFor = (chart: SizeChartDto, measurement: string) =>
      chart.check.items.filter((i) => i.measurementType === measurement).map((i) => i.code);
    const tiesFor = (chart: SizeChartDto, measurement: string) =>
      chart.check.items
        .filter((i) => i.measurementType === measurement && i.code === 'MAX_TIE')
        .map((i) => i.sizes);

    // Seeded female lengths repeat the same max across sizes (e.g. long length 62, 62, 62).
    expect(tiesFor(female, 'long_length')).toEqual([
      ['XS-6', 'S-8', 'S-10'],
      ['M-12', 'L-14', 'XL-16', 'XL-18', 'XXL-20'],
    ]);
    expect(tiesFor(female, 'short_length')).toEqual([
      ['S-8', 'S-10'],
      ['M-12', 'L-14', 'XL-16'],
      ['XL-18', 'XXL-20'],
    ]);
    expect(tiesFor(female, 'trouser_length')).toEqual([
      ['XS-6', 'S-8', 'S-10'],
      ['XL-16', 'XL-18', 'XXL-20'],
    ]);
    // Bust 33 / 36 / 38 / 42 ...: the old range "gaps" are not findings any more.
    expect(codesFor(female, 'bust')).toEqual(['UPPER_LIMIT']);
    expect(female.check.items.some((i) => i.code === 'MAX_NOT_INCREASING')).toBe(false);
    expect(female.check.warningCount).toBe(0);
    expect(female.check.noticeCount).toBe(7);

    const maleTop = await activeChart('male_top');
    expect(codesFor(maleTop, 'chest')).toEqual(['UPPER_LIMIT']);
    expect(maleTop.check.items.some((i) => i.code === 'MAX_NOT_INCREASING')).toBe(false);

    for (const chart of [female, maleTop]) {
      const limits = chart.check.items.filter((i) => i.code === 'UPPER_LIMIT');
      expect(limits.map((i) => i.measurementType)).toEqual(
        chart.measurementTypes.map((m) => m.code),
      );
      expect(chart.check.infoCount).toBe(chart.measurementTypes.length);
      for (const limit of limits) {
        expect(limit.severity).toBe('info');
        expect(limit.message).toContain(
          'Values above this are out of range. Handling is pending client decision.',
        );
      }
    }
    expect(
      maleTop.check.items.find((i) => i.measurementType === 'chest' && i.code === 'UPPER_LIMIT')
        ?.values,
    ).toEqual([{ size: '3XL', maxInches: 53 }]);
  });

  it('lists measurement profiles with items, chart groups and the products using them', async () => {
    const created = await api.post('/products', {
      name: 'Aso Oke Two-Piece',
      slug: 'aso-oke-two-piece',
      clothingTypeId: await seededClothingTypeId(ctx),
      description: 'Top and trouser set.',
      priceMinor: 6_000_000,
      measurementProfileId: await seededProfileId(ctx, 'male_top_trouser_set'),
    });
    expect(created.status).toBe(201);

    const list = bodyOf<ApiList<MeasurementProfileDto>>(await api.get('/measurement-profiles'));
    expect(list.meta.total).toBe(8);
    const set = list.data.find((p) => p.code === 'male_top_trouser_set');
    expect(set?.items.map((i) => `${i.chartGroup.code}.${i.measurementType.code}`)).toEqual([
      'male_top.chest',
      'male_top.shoulder',
      'male_top.sleeve',
      'male_top.top_length',
      'male_trouser.waist',
      'male_trouser.hip',
      'male_trouser.thigh',
      'male_trouser.trouser_length',
    ]);
    expect(set).toMatchObject({ productCount: 1, productsTruncated: false });
    expect(set?.products.map((p) => p.slug)).toEqual(['aso-oke-two-piece']);
    expect(list.data.find((p) => p.code === 'fila_cap')?.productCount).toBe(0);
  });

  it('lists sizes ordered by sort_order and paginates', async () => {
    const page = bodyOf<ApiList<SizeDto>>(await api.get('/sizes?pageSize=5'));
    expect(page.data).toHaveLength(5);
    expect(page.meta.total).toBeGreaterThan(5);
    const all = bodyOf<ApiList<SizeDto>>(await api.get('/sizes?pageSize=50')).data;
    const orders = all.map((s) => s.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('answers 404 for unknown ids and 400 for malformed ones; has no write routes', async () => {
    const unknown = await api.get(`/size-charts/${UNKNOWN_ID}`);
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('NOT_FOUND');
    expect((await api.get(`/size-chart-groups/${UNKNOWN_ID}/charts`)).status).toBe(404);
    expect((await api.get('/size-charts/not-a-uuid')).status).toBe(400);
    const chartId = group('female').activeChart?.id ?? '';
    expect((await api.patch(`/size-charts/${chartId}`, { status: 'retired' })).status).toBe(404);
    expect((await api.post('/size-chart-groups', { code: 'x' })).status).toBe(404);
  });
});
