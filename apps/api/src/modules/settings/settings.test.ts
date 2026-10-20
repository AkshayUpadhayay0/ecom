import {
  ADMIN_EDITABLE_SETTING_KEYS,
  SETTING_KEYS,
  isAdminEditableSetting,
  type ApiData,
  type SettingDto,
} from '@urban-ibile/shared';
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
    // 9 Oct design: no product cap unless the client sets one.
    expect(settings.find((s) => s.key === 'catalog.max_active_products')).toMatchObject({
      value: null,
      defaultValue: null,
    });
    expect(settings.find((s) => s.key === 'catalog.page_size')).toMatchObject({
      value: 20,
      defaultValue: 20,
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

  describe('who may change which setting (decision 19 Oct 2026)', () => {
    const restricted = SETTING_KEYS.filter((key) => !isAdminEditableSetting(key));

    it('a normal admin gets 403 on every restricted key, for edit and for clear', async () => {
      const admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
      expect(restricted).toContain('media.max_video_bytes');
      expect(restricted.length).toBeGreaterThan(ADMIN_EDITABLE_SETTING_KEYS.length);
      const before = await ctx.db
        .selectFrom('app_settings')
        .select(['setting_key', 'value'])
        .execute();
      for (const key of restricted) {
        const current = before.find((row) => row.setting_key === key)?.value ?? null;
        const edit = await admin.patch(`/settings/${key}`, { value: current });
        expect(edit.status, `edit ${key}`).toBe(403);
        const clear = await admin.patch(`/settings/${key}`, { value: null });
        expect(clear.status, `clear ${key}`).toBe(403);
      }
      // Nothing changed and nothing was audited for the refused calls.
      const after = await ctx.db
        .selectFrom('app_settings')
        .select(['setting_key', 'value'])
        .execute();
      expect(after).toEqual(before);
      expect(await auditCount(ctx, { action: 'setting.update' })).toBe(0);
    });

    it('a normal admin can save and clear the allowed keys (audited)', async () => {
      const admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
      const values: Record<(typeof ADMIN_EDITABLE_SETTING_KEYS)[number], unknown> = {
        'support.email': 'help@example.com',
        'support.phone': '+2348000000000',
        'support.whatsapp': '+2348000000000',
        'social.links': [{ platform: 'instagram', url: 'https://instagram.com/example' }],
        'returns.return_address': 'PLACEHOLDER address for the test',
        'returns.return_instructions': 'PLACEHOLDER instructions for the test',
      };
      for (const key of ADMIN_EDITABLE_SETTING_KEYS) {
        const saved = await admin.patch(`/settings/${key}`, { value: values[key] });
        expect(saved.status, `save ${key}`).toBe(200);
        expect((await admin.patch(`/settings/${key}`, { value: null })).status).toBe(200);
        expect(await auditCount(ctx, { action: 'setting.update', entityId: key })).toBe(2);
      }
    });

    it('a super admin can change every key (audited)', async () => {
      const current = bodyOf<ApiData<SettingDto[]>>(await api.get('/settings')).data;
      for (const setting of current) {
        const res = await api.patch(`/settings/${setting.key}`, { value: setting.value });
        expect(res.status, setting.key).toBe(200);
      }
      expect(await auditCount(ctx, { action: 'setting.update' })).toBe(current.length);
    });
  });
});
