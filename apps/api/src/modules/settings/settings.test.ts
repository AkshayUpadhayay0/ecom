import type { ApiData, SettingDto } from '@urban-ibile/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  resetAdminApiData,
  restoreSettings,
  signInAdmin,
  snapshotSettings,
  type AdminClient,
  type SettingsSnapshot,
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

describe.skipIf(!hasTestDatabase)('admin settings API', () => {
  let ctx: TestContext;
  let api: AdminClient;
  let snapshot: SettingsSnapshot;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    snapshot = await snapshotSettings(ctx);
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    api = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    await ctx.db.destroy();
  });

  it('lists every known setting with its default', async () => {
    const res = await api.get('/settings');
    const settings = bodyOf<ApiData<SettingDto[]>>(res).data;
    expect(settings.find((s) => s.key === 'catalog.max_active_products')).toMatchObject({
      value: 100,
      defaultValue: 100,
    });
    expect(settings.find((s) => s.key === 'support.email')).toMatchObject({
      value: null,
      defaultValue: null,
    });
  });

  it('rejects unknown keys', async () => {
    const res = await api.patch('/settings/delivery.fee_lagos', { value: 1000 });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('UNKNOWN_SETTING');
  });

  it('validates values per key', async () => {
    expect((await api.patch('/settings/catalog.page_size', { value: 51 })).status).toBe(400);
    expect((await api.patch('/settings/catalog.page_size', { value: '20' })).status).toBe(400);
    expect((await api.patch('/settings/support.email', { value: 'not-an-email' })).status).toBe(
      400,
    );
    expect((await api.patch('/settings/brand.palette', { value: { primary: 'red' } })).status).toBe(
      400,
    );
    expect((await api.patch('/settings/catalog.page_size', {})).status).toBe(400);
  });

  it('stores values and allows NULL ("not provided yet"), auditing each change', async () => {
    const email = await api.patch('/settings/support.email', { value: 'help@example.com' });
    expect(bodyOf<ApiData<SettingDto>>(email).data.value).toBe('help@example.com');

    const links = await api.patch('/settings/social.links', {
      value: [{ platform: 'instagram', url: 'https://instagram.com/example' }],
    });
    expect(links.status).toBe(200);

    const cleared = await api.patch('/settings/support.email', { value: null });
    expect(cleared.status).toBe(200);
    expect(bodyOf<ApiData<SettingDto>>(cleared).data.value).toBeNull();
    const row = await ctx.db
      .selectFrom('app_settings')
      .select('value')
      .where('setting_key', '=', 'support.email')
      .executeTakeFirstOrThrow();
    expect(row.value).toBeNull();

    // A NULL limit falls back to its default (page size 20) instead of breaking lists.
    expect((await api.patch('/settings/catalog.page_size', { value: null })).status).toBe(200);
    const list = await api.get('/delivery-zones');
    expect(bodyOf<{ meta: { pageSize: number } }>(list).meta.pageSize).toBe(20);

    expect(await auditCount(ctx, { action: 'setting.update', entityId: 'support.email' })).toBe(2);
    const audit = await ctx.db
      .selectFrom('admin_audit_logs')
      .select(['before_data', 'after_data', 'ip_address'])
      .where('entity_id', '=', 'social.links')
      .executeTakeFirstOrThrow();
    expect(audit.before_data).toEqual({ value: null });
    expect(audit.ip_address).not.toBeNull();
  });
});
