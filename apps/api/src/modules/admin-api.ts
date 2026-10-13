import { Router, type RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import type { Database } from '../db/database.js';
import { requireAdminRole } from '../middleware/require-role.js';
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

export interface AdminApiDeps {
  env: Pick<Env, 'PUBLIC_WEB_URL' | 'SERIAL_HMAC_SECRET'>;
  db: Database;
  /** Admin-audience access token guard; applied to every route below. */
  requireAdmin: RequestHandler;
}

/**
 * Admin API: catalog, inventory, delivery zones, settings, content, audit logs (Phase 2) and
 * hidden pages + serial import (Phase 2b).
 */
export function createAdminApiRouter({ env, db, requireAdmin }: AdminApiDeps): Router {
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  const media = createMediaAssetsService(createMediaAssetsRepository());
  const clothingTypesRepository = createClothingTypesRepository();
  const sizesRepository = createSizesRepository();
  const productsRepository = createProductsRepository();
  const hiddenPagesRepository = createHiddenPagesRepository();
  const requireSuperAdmin = requireAdminRole('super_admin');

  const router = Router();
  router.use(requireAdmin);
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
  router.use(
    createSettingsRouter({ controller: createSettingsController(settings), requireSuperAdmin }),
  );
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
    createHiddenPagesAdminRouter(
      createHiddenPagesAdminController(
        createHiddenPagesAdminService({
          db,
          repository: hiddenPagesRepository,
          settings,
          publicWebUrl: env.PUBLIC_WEB_URL,
        }),
      ),
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
    createAuditRouter({
      controller: createAuditController(createAuditService({ db, settings })),
      requireSuperAdmin,
    }),
  );
  return router;
}
