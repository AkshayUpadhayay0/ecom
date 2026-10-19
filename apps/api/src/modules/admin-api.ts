import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { Database } from '../db/database.js';
import { apiRateLimit } from '../middleware/rate-limit.js';
import { requireAdminRole } from '../middleware/require-role.js';
import { createAdminCommerceRouter } from './admin-commerce.module.js';
import { createAdminReturnsModule } from './returns/returns.module.js';
import { createAuditController } from './audit/audit.controller.js';
import { createAuditRouter } from './audit/audit.routes.js';
import { createAuditService } from './audit/audit.service.js';
import { createCatalogController } from './catalog/catalog.controller.js';
import { createCatalogRouter } from './catalog/catalog.routes.js';
import { createClothingTypesRepository } from './catalog/clothing-types.repository.js';
import { createClothingTypesService } from './catalog/clothing-types.service.js';
import { createProductsRepository } from './catalog/products.repository.js';
import { createProductsService } from './catalog/products.service.js';
import { createSizesRepository } from './catalog/sizes.repository.js';
import { createSizesService } from './catalog/sizes.service.js';
import { createMeasurementProfilesRepository } from './blueprint/measurement-profiles.repository.js';
import { createSizeChartsController } from './blueprint/size-charts.controller.js';
import { createSizeChartsRepository } from './blueprint/size-charts.repository.js';
import { createSizeChartsRouter } from './blueprint/size-charts.routes.js';
import { createSizeChartsService } from './blueprint/size-charts.service.js';
import { createContentBlocksController } from './content/content-blocks.controller.js';
import { createContentBlocksRepository } from './content/content-blocks.repository.js';
import { createContentBlocksRouter } from './content/content-blocks.routes.js';
import { createContentBlocksService } from './content/content-blocks.service.js';
import { createDeliveryZonesController } from './delivery/delivery-zones.controller.js';
import { createDeliveryZonesRepository } from './delivery/delivery-zones.repository.js';
import { createDeliveryZonesRouter } from './delivery/delivery-zones.routes.js';
import { createDeliveryZonesService } from './delivery/delivery-zones.service.js';
import { createHiddenPagesAdminService } from './hidden-pages/hidden-pages-admin.service.js';
import { createHiddenPagesAdminController } from './hidden-pages/hidden-pages.controller.js';
import { createHiddenPagesRepository } from './hidden-pages/hidden-pages.repository.js';
import { createHiddenPagesAdminRouter } from './hidden-pages/hidden-pages.routes.js';
import { createInventoryController } from './inventory/inventory.controller.js';
import { createInventoryRouter } from './inventory/inventory.routes.js';
import { createInventoryService } from './inventory/inventory.service.js';
import { createVariantsRepository } from './inventory/variants.repository.js';
import { createMediaAssetsRepository } from './media/media-assets.repository.js';
import { createMediaAssetsService } from './media/media-assets.service.js';
import { buildMediaController } from './media/media.module.js';
import { createMediaRouter } from './media/media.routes.js';
import type { StorageProvider } from './media/storage/storage-provider.js';
import { createSerialHasher } from './serial-access/serial-hash.js';
import { createSerialsController } from './serial-access/serials.controller.js';
import { createSerialsRepository } from './serial-access/serials.repository.js';
import { createSerialsRouter } from './serial-access/serials.routes.js';
import { createSerialsService } from './serial-access/serials.service.js';
import { createSettingsController } from './settings/settings.controller.js';
import { createSettingsRepository } from './settings/settings.repository.js';
import { createSettingsRouter } from './settings/settings.routes.js';
import { createSettingsService } from './settings/settings.service.js';

export const ADMIN_API_PATH = '/admin';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AdminApiDeps {
  env: Pick<
    Env,
    | 'PUBLIC_WEB_URL'
    | 'SERIAL_HMAC_SECRET'
    | 'MEDIA_UPLOAD_RATE_LIMIT_WINDOW_MS'
    | 'MEDIA_UPLOAD_RATE_LIMIT_MAX'
    | 'ADMIN_WRITE_RATE_LIMIT_WINDOW_MS'
    | 'ADMIN_WRITE_RATE_LIMIT_MAX'
    | 'ADMIN_STATS_CACHE_SECONDS'
  >;
  db: Database;
  storage: StorageProvider;
  logger: Logger;
  /** Admin-audience access token guard; applied to every route below. */
  requireAdmin: RequestHandler;
}

/**
 * Admin API: catalog, inventory, delivery zones, settings, content, audit logs (Phase 2),
 * hidden pages + serial import (Phase 2b), orders, payment reviews, customers, stats (Phase 7a).
 */
export function createAdminApiRouter({
  env,
  db,
  storage,
  logger,
  requireAdmin,
}: AdminApiDeps): Router {
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  const media = createMediaAssetsService(createMediaAssetsRepository());
  const clothingTypesRepository = createClothingTypesRepository();
  const sizesRepository = createSizesRepository();
  const productsRepository = createProductsRepository();
  const hiddenPagesRepository = createHiddenPagesRepository();
  const requireSuperAdmin = requireAdminRole('super_admin');

  const router = Router();
  router.use(requireAdmin);
  // Every admin write (non-GET) shares one per-IP limit; reads are not limited here.
  const writeLimit = apiRateLimit({
    windowMs: env.ADMIN_WRITE_RATE_LIMIT_WINDOW_MS,
    max: env.ADMIN_WRITE_RATE_LIMIT_MAX,
  });
  router.use((req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    void writeLimit(req, res, next);
  });
  router.use(
    createCatalogRouter(
      createCatalogController({
        clothingTypes: createClothingTypesService({
          db,
          repository: clothingTypesRepository,
          settings,
        }),
        sizes: createSizesService({ db, repository: sizesRepository, settings }),
        products: createProductsService({
          db,
          repository: productsRepository,
          clothingTypes: clothingTypesRepository,
          measurementProfiles: createMeasurementProfilesRepository(),
          media,
          settings,
        }),
      }),
      requireSuperAdmin,
    ),
  );
  router.use(
    createInventoryRouter(
      createInventoryController(
        createInventoryService({
          db,
          repository: createVariantsRepository(),
          products: productsRepository,
          sizes: sizesRepository,
          settings,
        }),
      ),
    ),
  );
  router.use(
    createDeliveryZonesRouter(
      createDeliveryZonesController(
        createDeliveryZonesService({ db, repository: createDeliveryZonesRepository(), settings }),
      ),
    ),
  );
  router.use(createSettingsRouter({ controller: createSettingsController(settings) }));
  router.use(
    createContentBlocksRouter(
      createContentBlocksController(
        createContentBlocksService({
          db,
          repository: createContentBlocksRepository(),
          media,
          settings,
        }),
      ),
    ),
  );
  router.use(
    createSizeChartsRouter(
      createSizeChartsController(
        createSizeChartsService({ db, repository: createSizeChartsRepository(), settings }),
      ),
      requireSuperAdmin,
    ),
  );
  router.use(
    createHiddenPagesAdminRouter(
      createHiddenPagesAdminController(
        createHiddenPagesAdminService({
          db,
          repository: hiddenPagesRepository,
          settings,
          publicWebUrl: env.PUBLIC_WEB_URL,
        }),
      ),
      requireSuperAdmin,
    ),
  );
  router.use(
    createSerialsRouter({
      controller: createSerialsController(
        createSerialsService({
          db,
          repository: createSerialsRepository(),
          pages: hiddenPagesRepository,
          hasher: createSerialHasher(env.SERIAL_HMAC_SECRET),
          settings,
        }),
      ),
      requireSuperAdmin,
    }),
  );
  router.use(
    createMediaRouter({
      controller: buildMediaController({ db, storage, logger }),
      uploadLimit: apiRateLimit({
        windowMs: env.MEDIA_UPLOAD_RATE_LIMIT_WINDOW_MS,
        max: env.MEDIA_UPLOAD_RATE_LIMIT_MAX,
      }),
      requireSuperAdmin,
    }),
  );
  router.use(
    createAdminCommerceRouter({
      db,
      logger,
      settings,
      requireSuperAdmin,
      statsCacheSeconds: env.ADMIN_STATS_CACHE_SECONDS,
    }),
  );
  router.use(createAdminReturnsModule({ db, logger, settings, storage }));
  router.use(
    createAuditRouter({
      controller: createAuditController(createAuditService({ db, settings })),
      requireSuperAdmin,
    }),
  );
  return router;
}
