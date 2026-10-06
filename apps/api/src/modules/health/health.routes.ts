import { Router } from 'express';
import type { HealthController } from './health.controller.js';

export const HEALTH_PATH = '/health';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get(HEALTH_PATH, controller.get);
  return router;
}
