import type { Env } from '../../../config/env.js';
import { MOCK_WEBHOOK_SECRET, createMockPaymentProvider } from './mock-provider.js';
import type { PaymentProvider } from './payment-provider.js';
import { createPaystackProvider } from './paystack-provider.js';

/** The key that signs webhooks: Paystack's secret key, or the public MOCK key without one. */
export function webhookSigningSecret(env: Env): string {
  return env.PAYSTACK_SECRET_KEY ?? MOCK_WEBHOOK_SECRET;
}

/** Chosen by PAYMENT_PROVIDER (env validation refuses 'mock' in production). */
export function createPaymentProvider(env: Env, apiBasePath: string): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'paystack') {
    if (env.PAYSTACK_SECRET_KEY === undefined) {
      throw new Error("PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER is 'paystack'");
    }
    return createPaystackProvider({
      secretKey: env.PAYSTACK_SECRET_KEY,
      baseUrl: env.PAYSTACK_BASE_URL,
      timeoutMs: env.PAYSTACK_TIMEOUT_MS,
      verifyRetries: env.PAYSTACK_VERIFY_RETRIES,
    });
  }
  return createMockPaymentProvider({
    dir: env.MOCK_PAYMENTS_DIR,
    checkoutBaseUrl: `${env.API_PUBLIC_URL}${apiBasePath}`,
    webhookSecret: webhookSigningSecret(env),
  });
}
