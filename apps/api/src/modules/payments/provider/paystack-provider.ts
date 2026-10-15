import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  PaymentProviderError,
  isValidWebhookSignature,
  refundNotBuilt,
  type PaymentProvider,
  type ProviderTransaction,
  type ProviderTransactionStatus,
} from './payment-provider.js';

const RETRY_DELAY_MS = 300;
const HTTP_SERVER_ERROR = 500;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

export interface PaystackConfig {
  secretKey: string;
  baseUrl: string;
  timeoutMs: number;
  verifyRetries: number;
}

const initializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({ authorization_url: z.url() }),
});

const verifyDataSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish(),
  status: z.string(),
  reference: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  channel: z.string().nullish(),
  gateway_response: z.string().nullish(),
  paid_at: z.string().nullish(),
  // Paystack returns metadata as an object, or as a string / empty string in some cases.
  metadata: z.unknown().optional(),
});
const verifyResponseSchema = z.object({ status: z.boolean(), data: verifyDataSchema.optional() });

/** Paystack transaction states -> ours ('ongoing', 'processing', 'queued' ... = still pending). */
function normaliseStatus(status: string): ProviderTransactionStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
    case 'reversed':
      return 'failed';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'pending';
  }
}

function metadataOrderId(metadata: unknown): string | null {
  let value = metadata;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && 'orderId' in value) {
    return typeof value.orderId === 'string' ? value.orderId : null;
  }
  return null;
}

/**
 * Paystack (https://paystack.com/docs/api/transaction). The secret key is only ever sent in the
 * Authorization header and never logged. Initialize is not retried (it could create two
 * transactions); verify is a safe read and is retried on network errors / 5xx.
 */
export function createPaystackProvider(config: PaystackConfig): PaymentProvider {
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    try {
      return await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'network error';
      throw new PaymentProviderError(
        `Paystack ${method} ${path.split('/')[1] ?? ''} failed: ${reason}`,
        true,
      );
    }
  }

  async function verifyOnce(reference: string): Promise<ProviderTransaction | null> {
    const res = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (res.status >= HTTP_SERVER_ERROR) {
      throw new PaymentProviderError(`Paystack verify answered ${res.status}`, true);
    }
    // Unknown reference: Paystack answers 400/404 "Transaction reference not found".
    if (res.status === HTTP_NOT_FOUND || res.status === HTTP_BAD_REQUEST) return null;
    if (!res.ok) throw new PaymentProviderError(`Paystack verify answered ${res.status}`, false);
    const parsed = verifyResponseSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.status || !parsed.data.data) {
      throw new PaymentProviderError('Unexpected Paystack verify response', false);
    }
    const data = parsed.data.data;
    return {
      reference: data.reference,
      status: normaliseStatus(data.status),
      amountMinor: data.amount,
      currency: data.currency.toUpperCase(),
      transactionId: data.id === null || data.id === undefined ? null : String(data.id),
      channel: data.channel ?? null,
      gatewayResponse: data.gateway_response ?? null,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      metadataOrderId: metadataOrderId(data.metadata),
    };
  }

  return {
    name: 'paystack',
    mocked: false,

    async initialize(input) {
      const res = await call('POST', '/transaction/initialize', {
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      });
      if (!res.ok) {
        throw new PaymentProviderError(
          `Paystack initialize answered ${res.status}`,
          res.status >= HTTP_SERVER_ERROR,
        );
      }
      const parsed = initializeResponseSchema.safeParse(await res.json());
      if (!parsed.success)
        throw new PaymentProviderError('Unexpected Paystack initialize response', false);
      return { authorizationUrl: parsed.data.data.authorization_url };
    },

    async verify(reference) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await verifyOnce(reference);
        } catch (err) {
          const retry =
            err instanceof PaymentProviderError && err.retryable && attempt < config.verifyRetries;
          if (!retry) throw err;
          await delay(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    },

    verifyWebhookSignature(rawBody, signature) {
      return isValidWebhookSignature(rawBody, signature, config.secretKey);
    },

    refund: refundNotBuilt,
  };
}
