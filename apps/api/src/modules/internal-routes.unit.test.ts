import type { RequestHandler, Router } from 'express';
import { describe, expect, it } from 'vitest';
import { createAuditRouter } from './audit/audit.routes.js';
import { createSizeChartsRouter } from './blueprint/size-charts.routes.js';
import { createCatalogRouter } from './catalog/catalog.routes.js';
import { createHiddenPagesAdminRouter } from './hidden-pages/hidden-pages.routes.js';
import { createMediaRouter } from './media/media.routes.js';
import { createSerialsRouter } from './serial-access/serials.routes.js';

/*
 * Structural guard for the Internal (developer) section, decision 19 Oct 2026. Every route of the
 * four internal pages must carry the super_admin guard. This test inspects the routers
 * themselves, so a NEW internal route added without the guard fails here even before anyone
 * writes an HTTP test for it. (admin-access.test.ts checks the same rules over HTTP.)
 */

const GUARD: RequestHandler = (_req, _res, next) => {
  next();
};
const noop: RequestHandler = (_req, _res, next) => {
  next();
};

/** A controller stub whose every handler is a no-op (typed `never` so it fits any controller). */
const stub = new Proxy({}, { get: () => noop }) as never;

interface RouteInfo {
  method: string;
  path: string;
  guarded: boolean;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}

function routesOf(router: Router): RouteInfo[] {
  // Express 5 keeps registered routes on router.stack (internal but stable across 5.x).
  const stack = (router as unknown as { stack: Layer[] }).stack;
  return stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map((method) => ({
          method: method.toUpperCase(),
          path: layer.route?.path ?? '',
          guarded: layer.route?.stack.some((s) => s.handle === GUARD) ?? false,
        }))
      : [],
  );
}

describe('internal section routes are super_admin only', () => {
  it('QR Pages (hidden pages incl. content edit): every route is guarded', () => {
    const routes = routesOf(createHiddenPagesAdminRouter(stub, GUARD));
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /hidden-pages',
        'GET /hidden-pages/:id',
        'PUT /hidden-pages/:id/content',
      ]),
    );
    expect(routes.filter((r) => !r.guarded)).toEqual([]);
  });

  it('serials (import, batches, deactivate): every route is guarded', () => {
    const routes = routesOf(createSerialsRouter({ controller: stub, requireSuperAdmin: GUARD }));
    expect(routes).toHaveLength(3);
    expect(routes.filter((r) => !r.guarded)).toEqual([]);
  });

  it('Audit Log: every route is guarded', () => {
    const routes = routesOf(createAuditRouter({ controller: stub, requireSuperAdmin: GUARD }));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !r.guarded)).toEqual([]);
  });

  it('Sizes & Charts: chart groups, versions and grids are guarded; only profile names stay open', () => {
    const routes = routesOf(createSizeChartsRouter(stub, GUARD));
    const open = routes.filter((r) => !r.guarded).map((r) => `${r.method} ${r.path}`);
    // The product form needs measurement profile names (CLAUDE.md rule 13).
    expect(open).toEqual(['GET /measurement-profiles']);
  });

  it('Sizes & Charts: reordering sizes is guarded; listing sizes stays open for the product form', () => {
    const routes = routesOf(createCatalogRouter(stub, GUARD));
    const guarded = routes.filter((r) => r.guarded).map((r) => `${r.method} ${r.path}`);
    expect(guarded).toEqual(['PUT /sizes/order']);
  });

  it('Media Library: browse, signed URLs and purge are guarded; only product-form routes stay open', () => {
    const routes = routesOf(
      createMediaRouter({
        controller: stub,
        uploadLimit: noop,
        requireSuperAdmin: GUARD,
      }),
    );
    const open = routes
      .filter((r) => !r.guarded)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    // Product form (every admin; the service restricts them to public product media).
    expect(open).toEqual(
      [
        'GET /media/:id',
        'GET /media/picker',
        'POST /media/:id/complete',
        'POST /media/:id/retry',
        'POST /media/uploads',
      ].sort(),
    );
  });
});
