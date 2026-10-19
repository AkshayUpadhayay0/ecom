import { randomUUID } from 'node:crypto';
import type { ApiData, SettingDto, SizeDto } from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  insertMediaAsset,
  resetAdminApiData,
  restoreSettings,
  signInAdmin,
  snapshotSettings,
  type AdminClient,
  type SettingsSnapshot,
} from '../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../test/helpers.js';

const ADMIN = '/api/v1/admin';
const FORBIDDEN = 403;
const UNAUTHORISED = 401;

type Method = 'get' | 'post' | 'put' | 'patch';

interface RestrictedRoute {
  name: string;
  method: Method;
  path: string;
  body?: object;
  /** Raw text body (CSV upload). */
  csv?: string;
  /** Status a super admin gets with this (harmless) request; any non-401/403 if undefined. */
  superStatus?: number;
}

/**
 * Role matrix (decision 19 Oct 2026). Internal tools (Media Library, Sizes & Charts grids, QR
 * Pages + serials, Audit Log), customer suspend/enable and sensitive settings are super_admin
 * only, enforced by the API. Write requests use deliberately invalid or no-op bodies so the
 * super_admin call proves access (passes the role guard) without changing seed data.
 */
describe.skipIf(!hasTestDatabase)('admin role matrix', () => {
  let ctx: TestContext;
  let admin: AdminClient;
  let superAdmin: AdminClient;
  let snapshot: SettingsSnapshot;
  let routes: RestrictedRoute[];

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    snapshot = await snapshotSettings(ctx);
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
    superAdmin = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);

    const page = await ctx.db.selectFrom('qr_pages').select('id').executeTakeFirstOrThrow();
    const group = await ctx.db
      .selectFrom('size_chart_groups')
      .select('id')
      .executeTakeFirstOrThrow();
    const chart = await ctx.db.selectFrom('size_charts').select('id').executeTakeFirstOrThrow();
    const sizes = await ctx.db
      .selectFrom('sizes')
      .select('id')
      .orderBy('sort_order')
      .orderBy('code')
      .execute();
    const asset = await insertMediaAsset(ctx, { kind: 'image', status: 'ready' });
    const unknown = randomUUID();

    routes = [
      { name: 'media library list', method: 'get', path: '/media', superStatus: 200 },
      { name: 'media signed url', method: 'get', path: `/media/${asset}/url` },
      { name: 'media purge', method: 'post', path: `/media/${asset}/purge`, superStatus: 409 },
      {
        name: 'media purge retired',
        method: 'post',
        path: '/media/purge-retired',
        superStatus: 200,
      },
      {
        name: 'size reorder',
        method: 'put',
        path: '/sizes/order',
        body: { ids: sizes.map((s) => s.id) },
        superStatus: 200,
      },
      { name: 'size chart groups', method: 'get', path: '/size-chart-groups', superStatus: 200 },
      {
        name: 'size chart versions',
        method: 'get',
        path: `/size-chart-groups/${group.id}/charts`,
        superStatus: 200,
      },
      {
        name: 'size chart grid',
        method: 'get',
        path: `/size-charts/${chart.id}`,
        superStatus: 200,
      },
      { name: 'hidden pages list', method: 'get', path: '/hidden-pages', superStatus: 200 },
      {
        name: 'hidden page detail',
        method: 'get',
        path: `/hidden-pages/${page.id}`,
        superStatus: 200,
      },
      {
        name: 'hidden page edit content',
        method: 'put',
        path: `/hidden-pages/${page.id}/content`,
        body: { title: '', body: '' },
        superStatus: 400,
      },
      {
        name: 'serial import',
        method: 'post',
        path: '/serial-imports?dryRun=true',
        csv: ' ',
        superStatus: 400,
      },
      { name: 'serial batches', method: 'get', path: '/serial-batches', superStatus: 200 },
      {
        name: 'serial deactivate',
        method: 'post',
        path: '/serials/deactivate',
        body: {},
        superStatus: 400,
      },
      { name: 'audit log', method: 'get', path: '/audit-logs', superStatus: 200 },
      {
        name: 'customer suspend',
        method: 'patch',
        path: `/customers/${unknown}/status`,
        body: { status: 'suspended', reason: 'matrix test' },
        superStatus: 404,
      },
      {
        name: 'sensitive setting',
        method: 'patch',
        path: '/settings/payments.reconcile_batch',
        body: { value: -1 },
        superStatus: 400,
      },
    ];
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    await ctx.db.destroy();
  });

  function call(token: AdminClient, route: RestrictedRoute) {
    if (route.csv !== undefined) {
      return token.post(route.path).set('Content-Type', 'text/csv').send(route.csv);
    }
    if (route.method === 'get') return token.get(route.path);
    if (route.method === 'post') return token.post(route.path, route.body ?? {});
    if (route.method === 'put') return token.put(route.path, route.body ?? {});
    return token.patch(route.path, route.body ?? {});
  }

  it('refuses every restricted route to a normal admin (403) and lets a super admin through', async () => {
    for (const route of routes) {
      const asAdmin = await call(admin, route);
      expect(asAdmin.status, `admin: ${route.name}`).toBe(FORBIDDEN);
      const asSuper = await call(superAdmin, route);
      if (route.superStatus === undefined) {
        expect([UNAUTHORISED, FORBIDDEN], `super: ${route.name}`).not.toContain(asSuper.status);
      } else {
        expect(asSuper.status, `super: ${route.name}`).toBe(route.superStatus);
      }
    }
  });

  it('keeps what the product form and the 10 client pages need open to a normal admin', async () => {
    const sizes = await admin.get('/sizes?pageSize=50');
    expect(sizes.status).toBe(200);
    expect(bodyOf<{ data: SizeDto[] }>(sizes).data.length).toBeGreaterThan(0);
    expect((await admin.get('/measurement-profiles')).status).toBe(200);
    expect((await admin.get('/media/picker?kind=image')).status).toBe(200);
    for (const path of [
      '/orders',
      '/payment-reviews',
      '/returns',
      '/customers',
      '/products',
      '/clothing-types',
      '/inventory/low-stock',
      '/content-blocks',
      '/delivery-zones',
      '/settings',
      '/stats/overview',
    ]) {
      expect((await admin.get(path)).status, path).toBe(200);
    }
  });

  it('lets a normal admin change only the client contact and return-address settings', async () => {
    const res = await admin.patch('/settings/support.email', { value: 'help@example.com' });
    expect(res.status).toBe(200);
    expect(bodyOf<ApiData<SettingDto>>(res).data.value).toBe('help@example.com');
    // Still audited for a normal admin.
    expect(await auditCount(ctx, { action: 'setting.update', entityId: 'support.email' })).toBe(1);
    expect((await admin.patch('/settings/catalog.page_size', { value: 24 })).status).toBe(
      FORBIDDEN,
    );
    expect((await admin.patch('/settings/store.currency', { value: 'USD' })).status).toBe(
      FORBIDDEN,
    );
  });

  it('refuses unauthenticated calls to the new media routes', async () => {
    expect((await request(ctx.app).get(`${ADMIN}/media/picker`)).status).toBe(UNAUTHORISED);
  });
});
