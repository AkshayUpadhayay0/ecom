import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { Database } from './db/database.js';
import { corsAllowList } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { ADMIN_AUTH_PATH } from './modules/admin-users/admin-auth.routes.js';
import { ADMIN_API_PATH, createAdminApiRouter } from './modules/admin-api.js';
import { createAdminAuthModule } from './modules/admin-users/admin-auth.module.js';
import { createCustomerAuthModule } from './modules/auth/auth.module.js';
import { CUSTOMER_AUTH_PATH } from './modules/auth/auth.routes.js';
import { buildMediaController } from './modules/media/media.module.js';
import { CUSTOMER_MEDIA_PATH, createCustomerMediaRouter } from './modules/media/media.routes.js';
import { createStorage, isLocalStorage } from './modules/media/storage/create-storage.js';
import { LOCAL_MEDIA_PATH } from './modules/media/storage/local-storage.js';
import { createLocalMediaRouter } from './modules/media/storage/local-media.routes.js';
import type { StorageProvider } from './modules/media/storage/storage-provider.js';
import { createHiddenPagesPublicRouter } from './modules/hidden-pages/hidden-pages.module.js';
import { HIDDEN_PAGES_PATH } from './modules/hidden-pages/hidden-pages.routes.js';
import { createPublicCatalogController } from './modules/catalog/public-catalog.controller.js';
import { createPublicCatalogRepository } from './modules/catalog/public-catalog.repository.js';
import {
  PUBLIC_CATALOG_PATH,
  createPublicCatalogRouter,
} from './modules/catalog/public-catalog.routes.js';
import { createPublicCatalogService } from './modules/catalog/public-catalog.service.js';
import { createSiteConfigRepository } from './modules/content/site-config.repository.js';
import { SITE_PATH, createSiteConfigRouter } from './modules/content/site-config.routes.js';
import { createSiteConfigService } from './modules/content/site-config.service.js';
import { createSettingsRepository } from './modules/settings/settings.repository.js';
import { createSettingsService } from './modules/settings/settings.service.js';
import {
  BLUEPRINT_PATH,
  BODY_SCAN_PATH,
  BODY_SCAN_WEBHOOK_PATH,
  MY_BLUEPRINT_PATH,
  createBlueprintModule,
} from './modules/blueprint/blueprint.module.js';
import { createHealthController } from './modules/health/health.controller.js';
import { createHealthRepository } from './modules/health/health.repository.js';
import { HEALTH_PATH, createHealthRouter } from './modules/health/health.routes.js';
import { createHealthService } from './modules/health/health.service.js';
import { createEmailOutboxRepository } from './modules/notifications/email-outbox.repository.js';
import { createCommerceRouter } from './modules/commerce.module.js';

export const API_BASE_PATH = '/api/v1';
const JSON_BODY_LIMIT = '100kb';

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Database;
  /** Injected in tests; otherwise built from MEDIA_STORAGE_DRIVER. */
  storage?: StorageProvider;
}

/** Builds the Express app. Has no side effects (no listen), so tests can use it directly. */
export function createApp({ env, logger, db, storage: injectedStorage }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowList(env.CORS_ORIGINS));

  // Provider webhooks need the raw body (signature check), so they are mounted before the JSON
  // router below; the module is built later with the customer guard.
  const webhookSlot = express.Router();
  app.use(`${API_BASE_PATH}${BODY_SCAN_WEBHOOK_PATH}`, webhookSlot);

  const v1 = express.Router();
  v1.use(
    apiRateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      skipPaths: [HEALTH_PATH],
    }),
  );
  // NOTE (Phase 6): the Paystack webhook route needs the raw body and must be mounted
  // with express.raw() BEFORE this JSON parser.
  v1.use(express.json({ limit: JSON_BODY_LIMIT }));
  v1.use(cookieParser());

  const healthService = createHealthService({
    repository: createHealthRepository(db),
    dbTimeoutMs: env.DB_HEALTH_TIMEOUT_MS,
  });
  v1.use(createHealthRouter(createHealthController(healthService)));

  const outbox = createEmailOutboxRepository();
  const customerAuth = createCustomerAuthModule({
    env,
    db,
    logger,
    outbox,
    basePath: API_BASE_PATH,
  });
  v1.use(CUSTOMER_AUTH_PATH, customerAuth.router);
  const storage = injectedStorage ?? createStorage(env, API_BASE_PATH);
  if (isLocalStorage(storage)) {
    // MOCK presigned URLs for local dev/test (never with R2 / in production).
    v1.use(LOCAL_MEDIA_PATH, createLocalMediaRouter(storage));
  }
  const adminAuth = createAdminAuthModule({ env, db, logger, basePath: API_BASE_PATH });
  v1.use(ADMIN_AUTH_PATH, adminAuth.router);
  // Every other /admin route requires an admin token (mounted after /admin/auth).
  v1.use(
    ADMIN_API_PATH,
    createAdminApiRouter({ env, db, storage, logger, requireAdmin: adminAuth.requireAdmin }),
  );
  const blueprint = createBlueprintModule({
    env,
    db,
    logger,
    requireCustomer: customerAuth.requireCustomer,
  });
  webhookSlot.use(blueprint.webhookRouter);
  v1.use(BLUEPRINT_PATH, blueprint.blueprintRouter);
  v1.use(MY_BLUEPRINT_PATH, blueprint.myRouter);
  v1.use(BODY_SCAN_PATH, blueprint.bodyScanRouter);
  v1.use(
    CUSTOMER_MEDIA_PATH,
    customerAuth.requireCustomer,
    createCustomerMediaRouter(buildMediaController({ db, storage, logger })),
  );
  // Public storefront (no login): stricter per-IP limit, short shared caching + ETags.
  const publicLimit = (): RequestHandler =>
    apiRateLimit({ windowMs: env.PUBLIC_RATE_LIMIT_WINDOW_MS, max: env.PUBLIC_RATE_LIMIT_MAX });
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  v1.use(
    PUBLIC_CATALOG_PATH,
    createPublicCatalogRouter(
      createPublicCatalogController(
        createPublicCatalogService({
          db,
          repository: createPublicCatalogRepository(),
          storage,
          settings,
        }),
        env.PUBLIC_CACHE_MAX_AGE_SECONDS,
      ),
      publicLimit(),
    ),
  );
  v1.use(
    SITE_PATH,
    createSiteConfigRouter(
      createSiteConfigService({ db, repository: createSiteConfigRepository(), storage }),
      publicLimit(),
      env.PUBLIC_CACHE_MAX_AGE_SECONDS,
    ),
  );
  v1.use(
    HIDDEN_PAGES_PATH,
    createHiddenPagesPublicRouter({
      env,
      db,
      logger,
      basePath: API_BASE_PATH,
      optionalCustomer: customerAuth.optionalCustomer,
    }),
  );

  v1.use(
    createCommerceRouter({
      env,
      db,
      logger,
      settings,
      requireCustomer: customerAuth.requireCustomer,
    }),
  );

  app.use(API_BASE_PATH, v1);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
