import express, { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { apiRateLimit } from '../../middleware/rate-limit.js';
import {
  BODY_SCAN_SIGNATURE_HEADER,
  createMockBodyScanProvider,
  type BodyScanProvider,
} from '../body-scan/body-scan-provider.js';
import { createBodyScanRepository } from '../body-scan/body-scan.repository.js';
import { createBodyScanService } from '../body-scan/body-scan.service.js';
import { createSettingsRepository } from '../settings/settings.repository.js';
import { createSettingsService } from '../settings/settings.service.js';
import { randomBytes } from 'node:crypto';
import { createBlueprintController } from './blueprint.controller.js';
import { createBlueprintRepository } from './blueprint.repository.js';
import { createBlueprintService } from './blueprint.service.js';

export const BLUEPRINT_PATH = '/blueprint';
export const MY_BLUEPRINT_PATH = '/me/blueprint';
export const BODY_SCAN_PATH = '/body-scan';
/** Mounted on the app (not the JSON router) so the raw body is available for signatures. */
export const BODY_SCAN_WEBHOOK_PATH = '/body-scan/webhooks';
const WEBHOOK_BODY_LIMIT = '64kb';
const SECRET_BYTES = 32;

export interface BlueprintModuleDeps {
  env: Pick<
    Env,
    | 'BODY_SCAN_PROVIDER'
    | 'BODY_SCAN_MOCK_WEBHOOK_SECRET'
    | 'RATE_LIMIT_WINDOW_MS'
    | 'RATE_LIMIT_MAX'
  >;
  db: Database;
  logger: Logger;
  requireCustomer: RequestHandler;
}

export interface BlueprintModule {
  blueprintRouter: Router;
  myRouter: Router;
  bodyScanRouter: Router;
  webhookRouter: Router;
}

function createProvider(env: BlueprintModuleDeps['env'], logger: Logger): BodyScanProvider | null {
  if (env.BODY_SCAN_PROVIDER === 'none') return null;
  logger.warn('Body Scan uses the MOCKED provider (fixed sample measurements, dev/test only)');
  return createMockBodyScanProvider(
    env.BODY_SCAN_MOCK_WEBHOOK_SECRET ?? randomBytes(SECRET_BYTES).toString('hex'),
  );
}

/** Blueprint (fitting) + Body Scan routes. Everything except the provider webhook needs login. */
export function createBlueprintModule(deps: BlueprintModuleDeps): BlueprintModule {
  const { db, logger, requireCustomer } = deps;
  const repository = createBlueprintRepository();
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  const bodyScan = createBodyScanService({
    db,
    repository: createBodyScanRepository(),
    blueprint: repository,
    settings,
    provider: createProvider(deps.env, logger),
    logger,
  });
  const controller = createBlueprintController(
    createBlueprintService({ db, repository, settings, bodyScan }),
    bodyScan,
  );

  const blueprintRouter = Router();
  blueprintRouter.use(requireCustomer);
  blueprintRouter.get('/products/:productId/requirements', controller.requirements);
  blueprintRouter.post('/recommendations', controller.recommend);
  blueprintRouter.post('/decisions', controller.decide);
  blueprintRouter.get('/decisions/:id', controller.getDecision);

  const myRouter = Router();
  myRouter.use(requireCustomer);
  myRouter.get('/decisions', controller.listMyDecisions);

  const bodyScanRouter = Router();
  bodyScanRouter.use(requireCustomer);
  bodyScanRouter.post('/sessions', controller.createScan);
  bodyScanRouter.get('/sessions/:id', controller.getScan);

  const webhookRouter = Router();
  webhookRouter.use(
    apiRateLimit({ windowMs: deps.env.RATE_LIMIT_WINDOW_MS, max: deps.env.RATE_LIMIT_MAX }),
  );
  webhookRouter.post(
    '/:provider',
    express.raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }),
    async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const accepted = await bodyScan.handleWebhook(
        req.params.provider,
        raw,
        req.get(BODY_SCAN_SIGNATURE_HEADER),
      );
      if (!accepted) {
        throw new AppError(
          'UNAUTHENTICATED',
          HTTP_STATUS.UNAUTHORIZED,
          'Invalid webhook signature.',
        );
      }
      res.status(HTTP_STATUS.NO_CONTENT).end();
    },
  );

  return { blueprintRouter, myRouter, bodyScanRouter, webhookRouter };
}
