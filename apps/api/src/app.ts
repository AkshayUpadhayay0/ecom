import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { Database } from './db/database.js';
import { corsAllowList } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { privateByDefault } from './middleware/private-cache.js';
import { notFound } from './middleware/not-found.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { createWebRevalidator, type WebRevalidator } from './lib/web-revalidate.js';
import { revalidateWebsiteAfterAdminWrites } from './middleware/web-revalidate.js';
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
import { createCustomerReturnsModule } from './modules/returns/returns.module.js';
import {
  MOCK_CHECKOUT_PATH,
  PAYMENTS_PATH,
  PAYSTACK_WEBHOOK_PATH,
  createPaymentsModule,
} from './modules/payments/payments.module.js';
import { createPaymentProvider } from './modules/payments/provider/create-provider.js';
import type { PaymentProvider } from './modules/payments/provider/payment-provider.js';

export const API_BASE_PATH = '/api/v1';
const JSON_BODY_LIMIT = '100kb';

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Database;
  /** Injected in tests; otherwise built from MEDIA_STORAGE_DRIVER. */
  storage?: StorageProvider;
  /** Injected in tests; otherwise built from PAYMENT_PROVIDER. */
  paymentProvider?: PaymentProvider;
  /** Injected in tests; otherwise built from WEB_REVALIDATE_URL / WEB_REVALIDATE_SECRET. */
  webRevalidator?: WebRevalidator;
}

/** Builds the Express app. Has no side effects (no listen), so tests can use it directly. */
export function createApp({
  env,
  logger,
  db,
  storage: injectedStorage,
  paymentProvider,
  webRevalidator,
}: AppDeps): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowList(env.CORS_ORIGINS));

  // Provider webhooks need the raw body (signature check), so they are mounted before the JSON
  // router below; the module is built later with the customer guard.
  const webhookSlot = express.Router();
  app.use(`${API_BASE_PATH}${BODY_SCAN_WEBHOOK_PATH}`, webhookSlot);
  const paystackWebhookSlot = express.Router();
  app.use(`${API_BASE_PATH}${PAYSTACK_WEBHOOK_PATH}`, paystackWebhookSlot);

  const v1 = express.Router();
  v1.use(
    apiRateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      skipPaths: [HEALTH_PATH],
    }),
  );
  // The Paystack webhook (raw body for the HMAC) is mounted above, before this JSON parser.
  v1.use(express.json({ limit: JSON_BODY_LIMIT }));
  v1.use(cookieParser());
  // Private by default; only the public storefront and public media files keep their own caching.
  v1.use(privateByDefault([PUBLIC_CATALOG_PATH, SITE_PATH, LOCAL_MEDIA_PATH]));

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
  const revalidator =
    webRevalidator ??
    createWebRevalidator({
      url: env.WEB_REVALIDATE_URL,
      secret: env.WEB_REVALIDATE_SECRET,
      logger,
    });
  v1.use(
    ADMIN_API_PATH,
    // After a successful admin write the website is told to refresh (no-op when not configured).
    revalidateWebsiteAfterAdminWrites(revalidator),
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
    createCustomerMediaRouter(
      buildMediaController({ db, storage, logger }),
      apiRateLimit({
        windowMs: env.CUSTOMER_UPLOAD_RATE_LIMIT_WINDOW_MS,
        max: env.CUSTOMER_UPLOAD_RATE_LIMIT_MAX,
      }),
    ),
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
      createSiteConfigService({
        db,
        repository: createSiteConfigRepository(),
        storage,
        passwordMinLength: env.PASSWORD_MIN_LENGTH,
      }),
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
    createCustomerReturnsModule({
      db,
      logger,
      settings,
      requireCustomer: customerAuth.requireCustomer,
      writeLimit: apiRateLimit({
        windowMs: env.RETURNS_RATE_LIMIT_WINDOW_MS,
        max: env.RETURNS_RATE_LIMIT_MAX,
      }),
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

  const payments = createPaymentsModule({
    env,
    db,
    logger,
    settings,
    provider: paymentProvider ?? createPaymentProvider(env, API_BASE_PATH),
    requireCustomer: customerAuth.requireCustomer,
  });
  paystackWebhookSlot.use(payments.webhookRouter);
  if (payments.mockCheckoutRouter) {
    // MOCK dev checkout page (PAYMENT_PROVIDER=mock only; refused in production).
    v1.use(MOCK_CHECKOUT_PATH, payments.mockCheckoutRouter);
  }
  v1.use(PAYMENTS_PATH, payments.router);

  app.use(API_BASE_PATH, v1);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
