import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { privateByDefault } from './private-cache.js';

function makeApp() {
  const app = express();
  app.use(privateByDefault(['/catalog', '/media-local']));
  app.get('/admin/media', (_req, res) => {
    res.json({ data: [{ id: 'a' }], meta: { page: 1 } });
  });
  app.get('/cart', (_req, res) => {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
  });
  app.get('/admin/stats', (_req, res) => {
    res.set('Cache-Control', 'private, no-store, max-age=0'); // a route's own, stricter header wins
    res.json({ data: 1 });
  });
  app.get('/catalog/products', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ data: [{ id: 'p' }] });
  });
  app.get('/catalogue-private', (_req, res) => {
    res.json({ data: 'a path that merely starts like a public prefix' });
  });
  return app;
}

describe('privateByDefault', () => {
  it.each(['/admin/media', '/cart', '/catalogue-private'])(
    '%s: no-store and no ETag',
    async (path) => {
      const res = await request(makeApp()).get(path);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.etag).toBeUndefined();
    },
  );

  it('answers a conditional request with a normal 200 body, never 304', async () => {
    const app = makeApp();
    for (const conditional of [
      { 'If-None-Match': '*' },
      { 'If-None-Match': 'W/"44-OwQPDzMuZFVyj++4nfjutEBSacY"' },
      { 'If-Modified-Since': new Date(Date.now() + 60_000).toUTCString() },
    ]) {
      const res = await request(app).get('/admin/media').set(conditional);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [{ id: 'a' }], meta: { page: 1 } });
    }
  });

  it("keeps a route's own stricter Cache-Control", async () => {
    const res = await request(makeApp()).get('/admin/stats');
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(res.headers.etag).toBeUndefined();
  });

  it('leaves the listed public prefixes alone: caching header, weak ETag and 304', async () => {
    const app = makeApp();
    const first = await request(app).get('/catalog/products');
    expect(first.headers['cache-control']).toBe('public, max-age=60');
    expect(first.headers.etag).toMatch(/^W\//);
    const second = await request(app)
      .get('/catalog/products')
      .set('If-None-Match', first.headers.etag as string);
    expect(second.status).toBe(304);
  });
});
