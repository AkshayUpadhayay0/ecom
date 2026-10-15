import { randomUUID } from 'node:crypto';
import type {
  ApiData,
  ApiErrorBody,
  ApiList,
  BlueprintRequirementsDto,
  BodyScanSessionDto,
  CustomerAuthDto,
  DecisionDto,
  RecommendationDto,
} from '@urban-ibile/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_CHART_PREFIX,
  resetAdminApiData,
  resetBlueprintData,
  seededClothingTypeId,
  seededProfileId,
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
import { BODY_SCAN_SIGNATURE_HEADER, signMockWebhook } from '../body-scan/body-scan-provider.js';

const API = '/api/v1';
const MALE_TOP = { chest: 42, shoulder: 17.5, sleeve: 24, top_length: 32 };
const SET = { ...MALE_TOP, waist: 37, hip: 38, thigh: 22, trouser_length: 39 };
const FEMALE_LONG = { bust: 34, waist: 28.5, hip: 35, long_length: 62 };

describe.skipIf(!hasTestDatabase)('Blueprint engine API', () => {
  let ctx: TestContext;
  let token: string;
  let otherToken: string;
  const products = {} as Record<'top' | 'set' | 'female' | 'plain', string>;
  const sizeIds = new Map<string, string>();

  async function register(): Promise<string> {
    const res = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send({
        email: `fit-${randomUUID().slice(0, 8)}@example.com`,
        password: 'Ankara-Velvet-2026!',
        fullName: 'Fit Tester',
        acceptTerms: true,
        client: 'ios',
      });
    expect(res.status).toBe(201);
    return bodyOf<ApiData<CustomerAuthDto>>(res).data.tokens.accessToken;
  }

  async function createProduct(
    slug: string,
    profileCode: string | null,
    sizes: Record<string, number>,
  ) {
    const product = await ctx.db
      .insertInto('products')
      .values({
        slug,
        name: slug,
        clothing_type_id: await seededClothingTypeId(ctx),
        price_minor: 100000,
        status: 'active',
        measurement_profile_id: profileCode ? await seededProfileId(ctx, profileCode) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [code, stock] of Object.entries(sizes)) {
      await ctx.db
        .insertInto('product_variants')
        .values({
          product_id: product.id,
          size_id: sizeIds.get(code) ?? '',
          sku: `${slug}-${code}`,
          stock_on_hand: stock,
        })
        .execute();
    }
    return product.id;
  }

  const as = (bearer: string) => ({
    get: (path: string) =>
      request(ctx.app).get(`${API}${path}`).set('Authorization', `Bearer ${bearer}`),
    post: (path: string, body: object) =>
      request(ctx.app).post(`${API}${path}`).set('Authorization', `Bearer ${bearer}`).send(body),
  });
  const me = () => as(token);
  const manual = (
    productId: string,
    measurements: Record<string, number>,
    fitPreference = 'standard',
  ) => ({
    productId,
    method: 'MANUAL_MEASUREMENTS',
    measurements,
    fitPreference,
  });
  async function recommend(body: object): Promise<RecommendationDto> {
    const res = await me().post('/blueprint/recommendations', body);
    expect(res.status).toBe(200);
    return bodyOf<ApiData<RecommendationDto>>(res).data;
  }
  async function decide(body: object): Promise<DecisionDto> {
    const res = await me().post('/blueprint/decisions', body);
    expect(res.status).toBe(201);
    return bodyOf<ApiData<DecisionDto>>(res).data;
  }
  const errorOf = (res: request.Response) => bodyOf<ApiErrorBody>(res).error;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    for (const row of await ctx.db.selectFrom('sizes').select(['id', 'code']).execute()) {
      sizeIds.set(row.code, row.id);
    }
    products.top = await createProduct('fit-kaftan', 'male_top', { M: 5, L: 0, XL: 3, XXL: 2 });
    products.set = await createProduct('fit-two-piece', 'male_top_trouser_set', { L: 2, XL: 2 });
    products.female = await createProduct('fit-long-dress', 'female_long', { 'S-8': 1, 'S-10': 1 });
    products.plain = await createProduct('fit-cap-no-profile', null, { M: 1 });
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    token = await register();
    otherToken = await register();
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  it('requires a customer login on every Blueprint and Body Scan route', async () => {
    const id = randomUUID();
    for (const [method, path] of [
      ['get', `/blueprint/products/${id}/requirements`],
      ['post', '/blueprint/recommendations'],
      ['post', '/blueprint/decisions'],
      ['get', `/blueprint/decisions/${id}`],
      ['get', '/me/blueprint/decisions'],
      ['post', '/body-scan/sessions'],
      ['get', `/body-scan/sessions/${id}`],
    ] as const) {
      expect((await request(ctx.app)[method](`${API}${path}`).send({})).status).toBe(401);
    }
  });

  it('lists the measurements a product needs, the fit options and Body Scan availability', async () => {
    const res = await me().get(`/blueprint/products/${products.top}/requirements`);
    const reqs = bodyOf<ApiData<BlueprintRequirementsDto>>(res).data;
    expect(reqs).toMatchObject({
      required: true,
      unit: 'in',
      profile: { code: 'male_top' },
      bodyScan: { available: true, mocked: true },
    });
    expect(reqs.measurements.map((m) => m.code)).toEqual([
      'chest',
      'shoulder',
      'sleeve',
      'top_length',
    ]);
    expect(reqs.fitOptions.map((f) => f.code)).toEqual(['tailored', 'standard', 'oversized']);
    const plain = bodyOf<ApiData<BlueprintRequirementsDto>>(
      await me().get(`/blueprint/products/${products.plain}/requirements`),
    ).data;
    expect(plain).toMatchObject({ required: false, profile: null, measurements: [] });
  });

  describe('engine against the real seeded charts', () => {
    it('male top: chest 42 -> L, 40.5 -> L, 54 -> out of range', async () => {
      const at = async (chest: number) => recommend(manual(products.top, { ...MALE_TOP, chest }));
      expect((await at(42)).recommendedSize.code).toBe('L');
      expect((await at(40.5)).recommendedSize.code).toBe('L');
      const res = await me().post(
        '/blueprint/recommendations',
        manual(products.top, { ...MALE_TOP, chest: 54 }),
      );
      expect(res.status).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'BLUEPRINT_OUT_OF_RANGE',
        message: 'We could not match this measurement to our size chart.',
        details: { measurements: [{ code: 'chest', valueInches: 54, side: 'above' }] },
      });
      const decision = await me().post('/blueprint/decisions', {
        ...manual(products.top, { ...MALE_TOP, chest: 54 }),
        selectionMode: 'LOCKED_RECOMMENDATION',
      });
      expect(decision.status).toBe(422);
      expect(
        Number(
          (
            await ctx.db
              .selectFrom('blueprint_decisions')
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        ),
      ).toBe(0);
    });

    it('female: bust 34 -> S-8, waist 28.5 -> S-10; the outfit takes the larger (S-10)', async () => {
      const rec = await recommend(manual(products.female, FEMALE_LONG));
      expect(rec.breakdown.map((b) => [b.code, b.requiredSize.code])).toEqual([
        ['bust', 'S-8'],
        ['waist', 'S-10'],
        ['hip', 'XS-6'],
        ['long_length', 'XS-6'],
      ]);
      expect(rec.recommendedSize.code).toBe('S-10');
    });

    it('two-piece set: one size, the larger of top (L) and trouser (XL)', async () => {
      const rec = await recommend(manual(products.set, SET));
      const sizeFor = (code: string) =>
        rec.breakdown.find((b) => b.code === code)?.requiredSize.code;
      expect([sizeFor('chest'), sizeFor('waist')]).toEqual(['L', 'XL']);
      expect(new Set(rec.breakdown.map((b) => b.chart.group))).toEqual(
        new Set(['male_top', 'male_trouser']),
      );
      expect(rec.recommendedSize.code).toBe('XL');
    });

    it('fit preference is stored but never changes the size', async () => {
      const sizes = await Promise.all(
        ['tailored', 'standard', 'oversized'].map(
          async (fit) =>
            (await recommend(manual(products.top, MALE_TOP, fit))).recommendedSize.code,
        ),
      );
      expect(sizes).toEqual(['L', 'L', 'L']);
      const res = await me().post(
        '/blueprint/recommendations',
        manual(products.top, MALE_TOP, 'baggy'),
      );
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    });

    it('reports stock for the recommendation and alternatives without reserving anything', async () => {
      const rec = await recommend(manual(products.top, MALE_TOP));
      expect(rec).toMatchObject({
        recommendedOffered: true,
        recommendedInStock: false,
        mocked: false,
      });
      expect(rec.alternatives.map((a) => [a.code, a.availability])).toEqual([
        ['M', 'in_stock'],
        ['L', 'out_of_stock'],
        ['XL', 'low_stock'],
        ['XXL', 'low_stock'],
      ]);
      const reserved = await ctx.db
        .selectFrom('product_variants')
        .select('stock_reserved')
        .where('product_id', '=', products.top)
        .execute();
      expect(reserved.every((r) => r.stock_reserved === 0)).toBe(true);
    });

    it('rejects missing, extra and invalid measurements with BLUEPRINT_MEASUREMENTS_INVALID', async () => {
      for (const measurements of [
        { chest: 42, shoulder: 17.5, sleeve: 24 }, // top_length missing
        { ...MALE_TOP, bust: 34 }, // not used for this product
        { ...MALE_TOP, chest: -1 },
        { ...MALE_TOP, chest: 42.25 }, // two decimals
        { ...MALE_TOP, chest: 400 }, // outside the sane limits (setting)
      ]) {
        const res = await me().post(
          '/blueprint/recommendations',
          manual(products.top, measurements),
        );
        expect(res.status).toBe(400);
        expect(errorOf(res).code).toBe('BLUEPRINT_MEASUREMENTS_INVALID');
      }
      const noProfile = await me().post(
        '/blueprint/recommendations',
        manual(products.plain, MALE_TOP),
      );
      expect(errorOf(noProfile).code).toBe('BLUEPRINT_NOT_APPLICABLE');
    });
  });

  describe('decisions', () => {
    it('locks the server-computed recommendation and stores reproducible measurements', async () => {
      const decision = await decide({
        ...manual(products.top, MALE_TOP),
        selectionMode: 'LOCKED_RECOMMENDATION',
      });
      expect(decision).toMatchObject({
        selectionMode: 'LOCKED_RECOMMENDATION',
        method: 'MANUAL_MEASUREMENTS',
        fitPreference: 'standard',
        recommendedSize: { code: 'L' },
        selectedSize: { code: 'L' },
        product: { id: products.top },
      });
      expect(
        decision.measurements.map((m) => [m.code, m.valueInches, m.requiredSize.code]),
      ).toEqual([
        ['chest', 42, 'L'],
        ['shoulder', 17.5, 'M'],
        ['sleeve', 24, 'M'],
        ['top_length', 32, 'M'],
      ]);
      expect(decision.chartSnapshot).toMatchObject({
        boundaryRule: 'SMALLEST_COVERING_SIZE',
        recommended: { code: 'L' },
      });
      const fetched = bodyOf<ApiData<DecisionDto>>(
        await me().get(`/blueprint/decisions/${decision.id}`),
      ).data;
      expect(fetched).toEqual(decision);
    });

    it('stores an OVERRIDE and validates the chosen size', async () => {
      const base = { ...manual(products.top, MALE_TOP), selectionMode: 'OVERRIDE' };
      const xl = sizeIds.get('XL');
      const override = await decide({ ...base, chosenSizeId: xl });
      expect(override).toMatchObject({
        selectionMode: 'OVERRIDE',
        recommendedSize: { code: 'L' },
        selectedSize: { code: 'XL' },
      });

      expect(errorOf(await me().post('/blueprint/decisions', base)).code).toBe('VALIDATION_ERROR');
      const notOffered = await me().post('/blueprint/decisions', {
        ...base,
        chosenSizeId: sizeIds.get('3XL'),
      });
      expect(errorOf(notOffered).code).toBe('INVALID_SIZE');
      const sameAsRecommended = await me().post('/blueprint/decisions', {
        ...base,
        chosenSizeId: sizeIds.get('L'),
      });
      expect(errorOf(sameAsRecommended).code).toBe('INVALID_SIZE');
    });

    it('never lets the client lock a size different from the computed one', async () => {
      const res = await me().post('/blueprint/decisions', {
        ...manual(products.top, MALE_TOP),
        selectionMode: 'LOCKED_RECOMMENDATION',
        chosenSizeId: sizeIds.get('XL'),
        recommendedSizeId: sizeIds.get('XL'), // ignored: never trusted
      });
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('INVALID_SIZE');
    });

    it("keeps each customer's decisions private", async () => {
      const decision = await decide({
        ...manual(products.top, MALE_TOP),
        selectionMode: 'LOCKED_RECOMMENDATION',
      });
      const other = as(otherToken);
      expect((await other.get(`/blueprint/decisions/${decision.id}`)).status).toBe(404);
      const otherList = bodyOf<ApiList<DecisionDto>>(await other.get('/me/blueprint/decisions'));
      expect(otherList.meta.total).toBe(0);
      const mine = bodyOf<ApiList<DecisionDto>>(
        await me().get(`/me/blueprint/decisions?productId=${products.top}`),
      );
      expect(mine.data.map((d) => d.id)).toEqual([decision.id]);
    });

    it('cannot be updated or deleted (database rules)', async () => {
      const decision = await decide({
        ...manual(products.top, MALE_TOP),
        selectionMode: 'LOCKED_RECOMMENDATION',
      });
      await expect(
        ctx.db
          .updateTable('blueprint_decisions')
          .set({ fit_preference: 'oversized' })
          .where('id', '=', decision.id)
          .execute(),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.db.deleteFrom('blueprint_decisions').where('id', '=', decision.id).execute(),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.db
          .updateTable('blueprint_measurements')
          .set({ value_inches: 30 })
          .where('decision_id', '=', decision.id)
          .execute(),
      ).rejects.toThrow(/append-only/);
    });

    it('stays reproducible after a new chart version is activated', async () => {
      const code = `${TEST_CHART_PREFIX}${randomUUID().slice(0, 8)}`;
      const chestId = (
        await ctx.db
          .selectFrom('measurement_types')
          .select('id')
          .where('code', '=', 'chest')
          .executeTakeFirstOrThrow()
      ).id;
      const group = await ctx.db
        .insertInto('size_chart_groups')
        .values({ code, name: 'Test group' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.db
        .insertInto('size_chart_group_measurements')
        .values({ group_id: group.id, measurement_type_id: chestId })
        .execute();
      const addChart = async (version: number, mMax: number, lMax: number) => {
        const chart = await ctx.db
          .insertInto('size_charts')
          .values({ group_id: group.id, version, name: `Test v${version}` })
          .returning('id')
          .executeTakeFirstOrThrow();
        await ctx.db
          .insertInto('size_chart_rows')
          .values([
            {
              chart_id: chart.id,
              group_id: group.id,
              size_id: sizeIds.get('M') ?? '',
              measurement_type_id: chestId,
              min_inches: 30,
              max_inches: mMax,
            },
            {
              chart_id: chart.id,
              group_id: group.id,
              size_id: sizeIds.get('L') ?? '',
              measurement_type_id: chestId,
              min_inches: mMax,
              max_inches: lMax,
            },
          ])
          .execute();
        return chart.id;
      };
      const v1 = await addChart(1, 40, 46);
      await ctx.db
        .updateTable('size_charts')
        .set({ status: 'active' })
        .where('id', '=', v1)
        .execute();
      const profile = await ctx.db
        .insertInto('measurement_profiles')
        .values({ code, name: 'Test profile' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.db
        .insertInto('measurement_profile_items')
        .values({ profile_id: profile.id, chart_group_id: group.id, measurement_type_id: chestId })
        .execute();
      const product = await ctx.db
        .insertInto('products')
        .values({
          slug: `${code.replace(/_/g, '-')}-shirt`,
          name: 'Versioned',
          clothing_type_id: await seededClothingTypeId(ctx),
          price_minor: 1,
          status: 'active',
          measurement_profile_id: profile.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const size of ['M', 'L']) {
        await ctx.db
          .insertInto('product_variants')
          .values({
            product_id: product.id,
            size_id: sizeIds.get(size) ?? '',
            sku: `${code}-${size}`,
            stock_on_hand: 1,
          })
          .execute();
      }

      const old = await decide({
        ...manual(product.id, { chest: 42 }),
        selectionMode: 'LOCKED_RECOMMENDATION',
      });
      expect(old.selectedSize.code).toBe('L');

      // New version: M now covers up to 44. Retire v1, activate v2 (one active chart per group).
      const v2 = await addChart(2, 44, 48);
      await sql`UPDATE size_charts SET status = 'retired' WHERE id = ${v1}`.execute(ctx.db);
      await ctx.db
        .updateTable('size_charts')
        .set({ status: 'active' })
        .where('id', '=', v2)
        .execute();

      const now = await recommend(manual(product.id, { chest: 42 }));
      expect(now.recommendedSize.code).toBe('M');
      expect(now.breakdown[0]?.chart).toMatchObject({ id: v2, version: 2 });
      const reread = bodyOf<ApiData<DecisionDto>>(
        await me().get(`/blueprint/decisions/${old.id}`),
      ).data;
      expect(reread).toEqual(old); // same sizes, same chart (v1), never recalculated
      expect(reread.measurements[0]?.chart).toMatchObject({ id: v1, version: 1 });
    });
  });

  describe('Body Scan (MOCK provider)', () => {
    it('runs a mocked scan end to end and decides from it', async () => {
      const created = await me().post('/body-scan/sessions', { productId: products.top });
      expect(created.status).toBe(201);
      const session = bodyOf<ApiData<BodyScanSessionDto>>(created).data;
      expect(session).toMatchObject({
        status: 'IN_PROGRESS',
        provider: 'mock',
        mocked: true,
        measurements: null,
      });

      const polled = bodyOf<ApiData<BodyScanSessionDto>>(
        await me().get(`/body-scan/sessions/${session.id}`),
      ).data;
      expect(polled.status).toBe('COMPLETED');
      expect(Object.keys(polled.measurements ?? {}).sort()).toEqual([
        'chest',
        'shoulder',
        'sleeve',
        'top_length',
      ]);

      const scanInput = {
        productId: products.top,
        method: 'BODY_SCAN',
        bodyScanSessionId: session.id,
        fitPreference: 'tailored',
      };
      const rec = await recommend(scanInput);
      expect(rec).toMatchObject({
        method: 'BODY_SCAN',
        mocked: true,
        recommendedSize: { code: 'L' },
      });
      const decision = await decide({ ...scanInput, selectionMode: 'LOCKED_RECOMMENDATION' });
      expect(decision).toMatchObject({ method: 'BODY_SCAN', bodyScanSessionId: session.id });

      // Someone else cannot use (or see) my scan.
      const other = as(otherToken);
      expect((await other.get(`/body-scan/sessions/${session.id}`)).status).toBe(404);
      const stolen = await other.post('/blueprint/recommendations', scanInput);
      expect(errorOf(stolen).code).toBe('BODY_SCAN_NOT_READY');
    });

    it('accepts only signed provider webhooks', async () => {
      const session = bodyOf<ApiData<BodyScanSessionDto>>(
        await me().post('/body-scan/sessions', { productId: products.top }),
      ).data;
      const body = JSON.stringify({
        externalRef: `mock-${session.id}`,
        status: 'FAILED',
        failureReason: 'Camera blocked',
      });
      const bad = await request(ctx.app)
        .post(`${API}/body-scan/webhooks/mock`)
        .set('Content-Type', 'application/json')
        .set(BODY_SCAN_SIGNATURE_HEADER, 'not-a-signature')
        .send(body);
      expect(bad.status).toBe(401);
      const good = await request(ctx.app)
        .post(`${API}/body-scan/webhooks/mock`)
        .set('Content-Type', 'application/json')
        .set(
          BODY_SCAN_SIGNATURE_HEADER,
          signMockWebhook(ctx.env.BODY_SCAN_MOCK_WEBHOOK_SECRET ?? '', body),
        )
        .send(body);
      expect(good.status).toBe(204);
      const after = bodyOf<ApiData<BodyScanSessionDto>>(
        await me().get(`/body-scan/sessions/${session.id}`),
      ).data;
      expect(after).toMatchObject({
        status: 'FAILED',
        failureReason: 'Camera blocked',
        measurements: null,
      });
      const noScan = await me().post('/blueprint/recommendations', {
        productId: products.top,
        method: 'BODY_SCAN',
        bodyScanSessionId: session.id,
        fitPreference: 'standard',
      });
      expect(errorOf(noScan).code).toBe('BODY_SCAN_NOT_READY');
    });
  });
});
