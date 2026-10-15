import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paymentReferenceSchema } from '@urban-ibile/shared';
import {
  isValidWebhookSignature,
  refundNotBuilt,
  type PaymentProvider,
  type ProviderTransaction,
  type ProviderTransactionStatus,
} from './payment-provider.js';

/**
 * MOCK signing key used when PAYSTACK_SECRET_KEY is not set. Public on purpose: the MOCK provider
 * is refused in production, and the simulate script must be able to sign without a real key.
 */
export const MOCK_WEBHOOK_SECRET = 'MOCK-paystack-webhook-secret-dev-only-not-a-real-key';
export const MOCK_CHECKOUT_PATH = '/payments/mock/checkout';
const MOCK_TRANSACTION_ID_MAX = 1_000_000_000;

/** MOCK transaction state, one JSON file per reference (shared by API, worker and scripts). */
export interface MockTransaction {
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  callbackUrl: string;
  metadata: { orderId: string; orderNumber: string };
  status: ProviderTransactionStatus;
  transactionId: string | null;
  paidAt: string | null;
  /** Test/dev overrides to simulate a mismatching provider answer. */
  reportedAmountMinor?: number;
  reportedCurrency?: string;
  reportedOrderId?: string;
}

export interface MockOutcome {
  status: 'success' | 'failed' | 'abandoned';
  amountMinor?: number;
  currency?: string;
  orderId?: string;
}

export interface MockPaymentProvider extends PaymentProvider {
  readonly name: 'mock';
  get(reference: string): Promise<MockTransaction | null>;
  /** "The customer paid / failed on the provider page" (dev checkout page, tests, script). */
  setOutcome(reference: string, outcome: MockOutcome): Promise<MockTransaction>;
}

/**
 * MOCK payment provider (no money moves). Initialize returns a link to the dev checkout page on
 * this API (Pay / Fail buttons); verify answers from the stored state. Refused in production.
 */
export function createMockPaymentProvider(config: {
  dir: string;
  checkoutBaseUrl: string;
  webhookSecret: string;
}): MockPaymentProvider {
  function fileOf(reference: string): string {
    // The reference format is checked so it can never escape the folder.
    return join(config.dir, `${paymentReferenceSchema.parse(reference)}.json`);
  }

  async function load(reference: string): Promise<MockTransaction | null> {
    try {
      return JSON.parse(await readFile(fileOf(reference), 'utf8')) as MockTransaction;
    } catch {
      return null;
    }
  }

  async function save(tx: MockTransaction): Promise<void> {
    await mkdir(config.dir, { recursive: true });
    await writeFile(fileOf(tx.reference), JSON.stringify(tx, null, 2), 'utf8');
  }

  function toProviderTransaction(tx: MockTransaction): ProviderTransaction {
    return {
      reference: tx.reference,
      status: tx.status,
      amountMinor: tx.reportedAmountMinor ?? tx.amountMinor,
      currency: tx.reportedCurrency ?? tx.currency,
      transactionId: tx.transactionId,
      channel: tx.status === 'pending' ? null : 'mock_card',
      gatewayResponse:
        tx.status === 'success'
          ? 'MOCK Approved'
          : tx.status === 'pending'
            ? null
            : 'MOCK Declined',
      paidAt: tx.paidAt === null ? null : new Date(tx.paidAt),
      metadataOrderId: tx.reportedOrderId ?? tx.metadata.orderId,
    };
  }

  return {
    name: 'mock',
    mocked: true,

    async initialize(input) {
      await save({
        reference: input.reference,
        email: input.email,
        amountMinor: input.amountMinor,
        currency: input.currency,
        callbackUrl: input.callbackUrl,
        metadata: input.metadata,
        status: 'pending',
        transactionId: null,
        paidAt: null,
      });
      return {
        authorizationUrl: `${config.checkoutBaseUrl}${MOCK_CHECKOUT_PATH}/${input.reference}`,
      };
    },

    async verify(reference) {
      const tx = await load(reference);
      return tx === null ? null : toProviderTransaction(tx);
    },

    verifyWebhookSignature(rawBody, signature) {
      return isValidWebhookSignature(rawBody, signature, config.webhookSecret);
    },

    refund: refundNotBuilt,

    get: load,

    async setOutcome(reference, outcome) {
      const tx = await load(reference);
      if (tx === null) throw new Error('Unknown MOCK payment reference');
      const updated: MockTransaction = {
        ...tx,
        status: outcome.status,
        transactionId: tx.transactionId ?? String(randomInt(1, MOCK_TRANSACTION_ID_MAX)),
        paidAt: outcome.status === 'success' ? new Date().toISOString() : null,
        ...(outcome.amountMinor !== undefined && { reportedAmountMinor: outcome.amountMinor }),
        ...(outcome.currency !== undefined && { reportedCurrency: outcome.currency }),
        ...(outcome.orderId !== undefined && { reportedOrderId: outcome.orderId }),
      };
      await save(updated);
      return updated;
    },
  };
}
