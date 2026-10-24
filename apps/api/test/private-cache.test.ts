import type { ApiData, ApiList, MediaLibraryItemDto } from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, resetAdminApiData, signInAdmin } from './admin-fixtures.js';
import { registerCustomer } from './commerce-fixtures.js';
import { assertSafeTestDatabase, bodyOf, hasTestDatabase, testDatabaseUrl } from './helpers.js';
import {
  makeMediaTestApp,
  tinyJpeg,
  uploadAndComplete,
  type MediaTestContext,
} from './media-fixtures.js';

const API = '/api/v1';

/**
 * Private answers must never be cached or revalidated: a browser that gets "304 Not Modified" for
 * the Media list hands the app an empty body. Public catalogue / site answers keep their rules.
 */
describe.skipIf(!hasTestDatabase)('cache headers on private and public routes', () => {
  let ctx: MediaTestContext;
  let adminToken: string;
  let customer: { token: string };

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    await resetAdminApiData(ctx);
    adminToken = (await signInAdmin(ctx)).token;
    customer = await registerCustomer(ctx);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  const bearer = (token: string) => (test: request.Test) =>
    test.set('Authorization', `Bearer ${token}`);

  it('every private route answers no-store without an ETag, signed in or not', async () => {
    const admin = bearer(adminToken);
    const buyer = bearer(customer.token);
    const checks: [string, (t: request.Test) => request.Test, number][] = [
      ['/admin/media?page=1&pageSize=24', admin, 200],
      ['/admin/media/picker', admin, 200],
      ['/admin/settings', admin, 200],
      ['/admin/orders?pageSize=5', admin, 200],
      ['/admin/products', admin, 200],
      ['/me/addresses', buyer, 200],
      ['/cart', buyer, 200],
      ['/me/orders', buyer, 200],
      ['/me/blueprint/decisions', buyer, 200],
      ['/auth/me', buyer, 200],
      ['/delivery/zones', buyer, 200],
      ['/admin/media', (t) => t, 401], // errors are private too
      ['/cart', (t) => t, 401],
      ['/me/orders', (t) => t, 401],
    ];
    for (const [path, auth, status] of checks) {
      const res = await auth(request(ctx.app).get(`${API}${path}`));
      expect(res.status, path).toBe(status);
      expect(res.headers['cache-control'], path).toMatch(/no-store/);
      expect(res.headers.etag, path).toBeUndefined();
    }
  });

  it('a conditional request to a private route is a normal 200, never 304', async () => {
    for (const path of ['/admin/media?page=1&pageSize=24', '/admin/settings', '/cart']) {
      const token = path === '/cart' ? customer.token : adminToken;
      for (const header of ['*', 'W/"1e71-jaOKty7StwYo3XblIRjTKCNXZjM"']) {
        const res = await bearer(token)(
          request(ctx.app).get(`${API}${path}`).set('If-None-Match', header),
        );
        expect(res.status, `${path} with If-None-Match ${header}`).toBe(200);
      }
    }
  });

  it('REGRESSION: the Media list always returns its JSON body, also for a conditional request', async () => {
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName: 'look.jpg',
      mimeType: 'image/jpeg',
      bytes: await tinyJpeg(),
    });
    const api = adminClient(ctx, adminToken);
    const first = await api.get('/media?page=1&pageSize=24');
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeUndefined();
    expect(bodyOf<ApiList<MediaLibraryItemDto>>(first).data.map((item) => item.id)).toContain(id);

    // What a browser, proxy or extension may send on the next visit.
    const again = await api.get('/media?page=1&pageSize=24').set('If-None-Match', '*');
    expect(again.status).toBe(200);
    expect(bodyOf<ApiList<MediaLibraryItemDto>>(again).data.map((item) => item.id)).toContain(id);
    expect(bodyOf<ApiData<unknown>>(await api.get(`/media/${id}`)).data).toBeTruthy();
  });

  it('public catalogue and site answers keep their caching rules (short max-age, weak ETag, 304)', async () => {
    for (const path of ['/catalog/products', '/catalog/clothing-types', '/site/config']) {
      const first = await request(ctx.app).get(`${API}${path}`);
      expect(first.status, path).toBe(200);
      expect(first.headers['cache-control'], path).toMatch(/public, max-age=\d+/);
      expect(first.headers.etag, path).toMatch(/^W\//);
      const second = await request(ctx.app)
        .get(`${API}${path}`)
        .set('If-None-Match', first.headers.etag as string);
      expect(second.status, path).toBe(304);
    }
  });
});
