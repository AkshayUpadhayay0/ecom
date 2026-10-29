import { expect, test } from '@playwright/test';

// Server-to-server cache invalidation (the API/worker call it; see apps/api/src/lib/web-revalidate.ts).
const ROUTE = '/api/revalidate';
const SECRET = 'e2e-revalidate-secret-not-for-production-0001';

test.describe('on-demand revalidation route', () => {
  test('refuses a call without the shared secret', async ({ request }) => {
    const none = await request.post(ROUTE, { data: { tags: ['catalog'] } });
    expect(none.status()).toBe(401);
    const wrong = await request.post(ROUTE, {
      data: { tags: ['catalog'] },
      headers: { Authorization: 'Bearer not-the-secret' },
    });
    expect(wrong.status()).toBe(401);
  });

  test('refuses tags it does not know', async ({ request }) => {
    const response = await request.post(ROUTE, {
      data: { tags: ['everything'] },
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.status()).toBe(400);
  });

  test('accepts the secret and revalidates the known tags', async ({ request }) => {
    const response = await request.post(ROUTE, {
      data: { tags: ['catalog', 'site'] },
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ revalidated: ['catalog', 'site'] });
    expect((await request.get('/')).ok()).toBe(true);
  });
});
