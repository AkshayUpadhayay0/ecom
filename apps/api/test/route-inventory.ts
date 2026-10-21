import type { Router } from 'express';
import { pino } from 'pino';
import { API_BASE_PATH } from '../src/app.js';
import { ADMIN_API_PATH, createAdminApiRouter } from '../src/modules/admin-api.js';
import { createAdminAuthModule } from '../src/modules/admin-users/admin-auth.module.js';
import { ADMIN_AUTH_PATH } from '../src/modules/admin-users/admin-auth.routes.js';
import { createStorage } from '../src/modules/media/storage/create-storage.js';
import type { TestContext } from './helpers.js';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/**
 * Every route registered on a router, as "METHOD /path". Admin sub-routers are mounted without
 * a path (router.use(sub)), so their paths are relative to the parent. Express 5 keeps routes on
 * router.stack (internal, stable across 5.x).
 */
export function routesOf(router: Router, prefix = ''): string[] {
  const walk = (stack: Layer[]): string[] =>
    stack.flatMap((layer) => {
      if (layer.route) {
        const { path, methods } = layer.route;
        return Object.keys(methods)
          .filter((m) => m !== '_all')
          .map((m) => `${m.toUpperCase()} ${prefix}${path}`);
      }
      return layer.handle?.stack ? walk(layer.handle.stack) : [];
    });
  return walk((router as unknown as { stack: Layer[] }).stack);
}

/** Every route the API registers under /admin (auth + the admin API), built like app.ts does. */
export function adminRouteInventory(ctx: TestContext): string[] {
  const logger = pino({ level: 'silent' });
  const auth = createAdminAuthModule({ env: ctx.env, db: ctx.db, logger, basePath: API_BASE_PATH });
  const api = createAdminApiRouter({
    env: ctx.env,
    db: ctx.db,
    storage: createStorage(ctx.env, API_BASE_PATH),
    logger,
    requireAdmin: auth.requireAdmin,
  });
  return [...routesOf(auth.router, ADMIN_AUTH_PATH), ...routesOf(api, ADMIN_API_PATH)].sort();
}
