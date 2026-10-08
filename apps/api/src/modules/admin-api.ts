import { Router, type RequestHandler } from 'express';
import type { Database } from '../db/database.js';
import { requireAdminRole } from '../middleware/require-role.js';
import { createAuditController } from './audit/audit.controller.js';
import { createAuditRouter } from './audit/audit.routes.js';
import { createAuditService } from './audit/audit.service.js';
import { createCatalogController } from './catalog/catalog.controller.js';
import { createCatalogRouter } from './catalog/catalog.routes.js';
import { createClothingTypesRepository } from './catalog/clothing-types.repository.js';
import { createClothingTypesService } from './catalog/clothing-types.service.js';
import { createGarmentCutsRepository } from './catalog/garment-cuts.repository.js';
import { createGarmentCutsService } from './catalog/garment-cuts.service.js';
import { createProductsRepository } from './catalog/products.repository.js';
import { createProductsService } from './catalog/products.service.js';
import { createSizesRepository } from './catalog/sizes.repository.js';
import { createSizesService } from './catalog/sizes.service.js';
import { createContentBlocksController } from './content/content-blocks.controller.js';
import { createContentBlocksRepository } from './content/content-blocks.repository.js';
import { createContentBlocksRouter } from './content/content-blocks.routes.js';
import { createContentBlocksService } from './content/content-blocks.service.js';
import { createDeliveryZonesController } from './delivery/delivery-zones.controller.js';
import { createDeliveryZonesRepository } from './delivery/delivery-zones.repository.js';
import { createDeliveryZonesRouter } from './delivery/delivery-zones.routes.js';
import { createDeliveryZonesService } from './delivery/delivery-zones.service.js';
import { createInventoryController } from './inventory/inventory.controller.js';
import { createInventoryRouter } from './inventory/inventory.routes.js';
import { createInventoryService } from './inventory/inventory.service.js';
import { createVariantsRepository } from './inventory/variants.repository.js';
import { createLanguagesRepository } from './localization/languages.repository.js';
import { createTranslationsService } from './localization/translations.service.js';
import { createMediaAssetsRepository } from './media/media-assets.repository.js';
import { createMediaAssetsService } from './media/media-assets.service.js';
import { createSettingsController } from './settings/settings.controller.js';
import { createSettingsRepository } from './settings/settings.repository.js';
import { createSettingsRouter } from './settings/settings.routes.js';
import { createSettingsService } from './settings/settings.service.js';

export const ADMIN_API_PATH = '/admin';

export interface AdminApiDeps {
  db: Database;
  /** Admin-audience access token guard; applied to every route below. */
  requireAdmin: RequestHandler;
}

/** Phase 2 admin API: catalog, inventory, delivery zones, settings, content, audit logs. */
export function createAdminApiRouter({ db, requireAdmin }: AdminApiDeps): Router {
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  const translations = createTranslationsService(createLanguagesRepository());
  const media = createMediaAssetsService(createMediaAssetsRepository());
  const clothingTypesRepository = createClothingTypesRepository();
  const garmentCutsRepository = createGarmentCutsRepository();
  const sizesRepository = createSizesRepository();
  const productsRepository = createProductsRepository();
  const requireSuperAdmin = requireAdminRole('super_admin');

  const router = Router();
  router.use(requireAdmin);
  router.use(
    createCatalogRouter(
      createCatalogController({
        clothingTypes: createClothingTypesService({
          db,
          repository: clothingTypesRepository,
          translations,
          settings,
        }),
        sizes: createSizesService({ db, repository: sizesRepository, settings }),
        garmentCuts: createGarmentCutsService({ db, repository: garmentCutsRepository, settings }),
        products: createProductsService({
          db,
          repository: productsRepository,
          clothingTypes: clothingTypesRepository,
          garmentCuts: garmentCutsRepository,
          translations,
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
          translations,
          media,
          settings,
        }),
      ),
    ),
  );
  router.use(
    createAuditRouter({
      controller: createAuditController(createAuditService({ db, settings })),
      requireSuperAdmin,
    }),
  );
  return router;
}
