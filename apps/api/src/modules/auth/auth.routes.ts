import { Router, type RequestHandler } from 'express';
import type { CustomerAuthController } from './auth.controller.js';

export const CUSTOMER_AUTH_PATH = '/auth';

export interface CustomerAuthRouteDeps {
  controller: CustomerAuthController;
  requireCustomer: RequestHandler;
  /** Factory: each sensitive route gets its own strict limiter. */
  strictLimit: () => RequestHandler;
}

export function createCustomerAuthRouter({
  controller,
  requireCustomer,
  strictLimit,
}: CustomerAuthRouteDeps): Router {
  const router = Router();
  router.post('/register', strictLimit(), controller.register);
  router.post('/login', strictLimit(), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireCustomer, controller.getMe);
  router.patch('/me', requireCustomer, controller.updateMe);
  router.post('/verify-email', strictLimit(), controller.verifyEmail);
  router.post(
    '/resend-verification',
    strictLimit(),
    requireCustomer,
    controller.resendVerification,
  );
  router.post('/forgot-password', strictLimit(), controller.forgotPassword);
  router.post('/reset-password', strictLimit(), controller.resetPassword);
  return router;
}
