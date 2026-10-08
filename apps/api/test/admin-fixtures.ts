import { randomUUID } from 'node:crypto';
import type { AdminAuthDto, ApiData, ApiErrorBody } from '@urban-ibile/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { createAccessTokens } from '../src/modules/auth/core/access-tokens.js';
import type { AdminRole } from '../src/modules/admin-users/admin-users.repository.js';
import { bodyOf, createTestAdmin, resetAuthTables, type TestContext } from './helpers.js';

export const ADMIN = '/api/v1/admin';
const ADMIN_PASSWORD = 'Ankara-Velvet-2026!';

/** Test data naming: everything a test creates starts with these prefixes so cleanup is exact. */
export const TEST_SLUG_PREFIX = 't-';
const TEST_SIZE_CODE_PREFIX = 'T';
/** Seeded size order (db/seed_v2.sql) restored after reorder tests. */
const SEED_SIZE_ORDER = ['S', 'M', 'L', 'XL', 'XXL'];

export interface AdminSession {
  id: string;
  token: string;
}

/** Creates an admin and signs in through the real login endpoint. */
export async function signInAdmin(
  ctx: TestContext,
  role: AdminRole = 'admin',
  email = `${role}-${randomUUID().slice(0, 8)}@example.com`,
): Promise<AdminSession> {
  const admin = await createTestAdmin(ctx, { email, password: ADMIN_PASSWORD, role });
  const res = await request(ctx.app)
    .post(`${ADMIN}/auth/login`)
    .send({ email, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return { id: admin.id, token: bodyOf<ApiData<AdminAuthDto>>(res).data.tokens.accessToken };
}

/** A valid CUSTOMER access token (customer secret + audience); must never open admin routes. */
export async function customerToken(ctx: TestContext): Promise<string> {
  const tokens = createAccessTokens({
    audience: 'customer',
    secret: ctx.env.JWT_ACCESS_SECRET,
    issuer: ctx.env.JWT_ISSUER,
    ttlSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
  });
  return (await tokens.sign({ subjectId: randomUUID(), sessionId: randomUUID() })).token;
}

export function errorCode(res: request.Response): string {
  return bodyOf<ApiErrorBody>(res).error.code;
}

/** Authenticated request helper bound to one admin token. */
export function adminClient(ctx: TestContext, token: string) {
  const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(ctx.app).get(`${ADMIN}${path}`)),
    post: (path: string, body: object = {}) =>
      auth(request(ctx.app).post(`${ADMIN}${path}`)).send(body),
    patch: (path: string, body: object) =>
      auth(request(ctx.app).patch(`${ADMIN}${path}`)).send(body),
    put: (path: string, body: object) => auth(request(ctx.app).put(`${ADMIN}${path}`)).send(body),
    delete: (path: string) => auth(request(ctx.app).delete(`${ADMIN}${path}`)),
  };
}
export type AdminClient = ReturnType<typeof adminClient>;

/**
 * TEST-ONLY: inserts a media_assets row directly. The upload pipeline that creates real assets
 * is Phase 3; the admin API only assigns existing assets.
 */
export async function insertMediaAsset(
  ctx: TestContext,
  input: { kind: 'video' | 'image'; status: 'pending' | 'processing' | 'ready' | 'failed' },
): Promise<string> {
  const row = await ctx.db
    .insertInto('media_assets')
    .values({
      kind: input.kind,
      original_key: `test/${randomUUID()}`,
      mime_type: input.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      size_bytes: 1024,
      processing_status: input.status,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface SettingsSnapshot {
  rows: { setting_key: string; value: unknown }[];
}

export async function snapshotSettings(ctx: TestContext): Promise<SettingsSnapshot> {
  return {
    rows: await ctx.db.selectFrom('app_settings').select(['setting_key', 'value']).execute(),
  };
}

export async function restoreSettings(ctx: TestContext, snapshot: SettingsSnapshot): Promise<void> {
  for (const row of snapshot.rows) {
    await ctx.db
      .updateTable('app_settings')
      .set({ value: row.value === null ? null : JSON.stringify(row.value), updated_by: null })
      .where('setting_key', '=', row.setting_key)
      .execute();
  }
}

/**
 * Removes everything the admin API tests create (catalog, stock, media, test zones/types/sizes)
 * and then the auth tables. Seeded reference data (languages, seeded sizes/types, sample zones,
 * content blocks, Blueprint sample rules) is kept.
 */
export async function resetAdminApiData(ctx: TestContext): Promise<void> {
  const { db } = ctx;
  await db.deleteFrom('stock_movements').execute();
  await db.deleteFrom('product_variants').execute();
  await db.deleteFrom('product_translations').execute();
  await db.deleteFrom('products').execute();
  await db.updateTable('content_blocks').set({ media_asset_id: null, updated_by: null }).execute();
  await db.deleteFrom('media_assets').execute();
  await db.deleteFrom('garment_cuts').execute();
  await db.deleteFrom('delivery_zones').where('is_sample_data', '=', false).execute();
  await db.updateTable('delivery_zones').set({ is_active: false }).execute();
  await db.deleteFrom('clothing_types').where('slug', 'like', `${TEST_SLUG_PREFIX}%`).execute();
  await db.deleteFrom('sizes').where('code', 'like', `${TEST_SIZE_CODE_PREFIX}%`).execute();
  for (const [index, code] of SEED_SIZE_ORDER.entries()) {
    await db
      .updateTable('sizes')
      .set({ sort_order: index + 1, is_active: true })
      .where('code', '=', code)
      .execute();
  }
  await resetAuthTables(db);
}

/** Id of a seeded clothing type / size by slug / code. */
export async function seededClothingTypeId(ctx: TestContext, slug = 'shirt'): Promise<string> {
  const row = await ctx.db
    .selectFrom('clothing_types')
    .select('id')
    .where('slug', '=', slug)
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function seededSizeId(ctx: TestContext, code = 'M'): Promise<string> {
  const row = await ctx.db
    .selectFrom('sizes')
    .select('id')
    .where('code', '=', code)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Number of audit rows for one entity and action (verifies "every write is audited"). */
export async function auditCount(
  ctx: TestContext,
  where: { action: string; entityId?: string },
): Promise<number> {
  let query = ctx.db
    .selectFrom('admin_audit_logs')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('action', '=', where.action);
  if (where.entityId !== undefined) query = query.where('entity_id', '=', where.entityId);
  return Number((await query.executeTakeFirstOrThrow()).n);
}
