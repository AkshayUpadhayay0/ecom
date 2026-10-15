import { createHmac, timingSafeEqual } from 'node:crypto';

/** Provider transaction state, normalised. 'pending' = not final yet (keep waiting). */
export type ProviderTransactionStatus = 'success' | 'failed' | 'abandoned' | 'pending';

/** What the server learns from the provider's verify call (the only source of truth). */
export interface ProviderTransaction {
  reference: string;
  status: ProviderTransactionStatus;
  amountMinor: number;
  currency: string;
  transactionId: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: Date | null;
  /** metadata.orderId we sent at initialize (null if the provider returned none). */
  metadataOrderId: string | null;
}

export interface InitializeInput {
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  callbackUrl: string;
  /** Only identifiers; never personal or payment data. */
  metadata: { orderId: string; orderNumber: string };
}

export interface PaymentProvider {
  readonly name: 'paystack' | 'mock';
  /** true for the MOCK provider (no real money). */
  readonly mocked: boolean;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string }>;
  /** null = the provider does not know this reference (yet). Throws PaymentProviderError. */
  verify(reference: string): Promise<ProviderTransaction | null>;
  /** HMAC-SHA512 of the RAW body with the secret key, compared in constant time. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Not built: refund policy is a Pending Client Decision. */
  refund(reference: string): Promise<never>;
}

/** Network error, timeout or provider 5xx: the result is unknown, try again later. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export function signWebhookBody(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/** Constant-time comparison of the hex signature (length is checked first; both are hex). */
export function isValidWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (signature === undefined || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function refundNotBuilt(): Promise<never> {
  return Promise.reject(
    new Error('Refunds are not built: the refund policy is a Pending Client Decision.'),
  );
}
