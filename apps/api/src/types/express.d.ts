import type { AdminPrincipal, CustomerPrincipal } from '../modules/auth/core/principals.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireCustomer. */
      customer?: CustomerPrincipal;
      /** Set by requireAdmin. */
      admin?: AdminPrincipal;
    }
  }
}

export {};
