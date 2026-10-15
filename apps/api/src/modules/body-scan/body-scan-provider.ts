import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Provider-neutral Body Scan adapter. The real provider/SDK and its capture rules (distance, poses,
 * calibration) are a TEAM DECISION and are NOT invented here. Providers return measurements only;
 * no images are ever stored.
 */
export interface ScanResult {
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  /** Inches by measurement code (COMPLETED only). */
  measurements?: Record<string, number>;
  failureReason?: string;
}

export interface BodyScanProvider {
  readonly name: string;
  /** true for the MOCK adapter: results are fixed sample values, not a real scan. */
  readonly mocked: boolean;
  startSession(input: {
    sessionId: string;
    measurementCodes: readonly string[];
  }): Promise<{ externalRef: string; captureUrl: string | null }>;
  /** Polls the provider for the session's result. */
  fetchResult(externalRef: string, measurementCodes: readonly string[]): Promise<ScanResult>;
  /** Verifies a provider callback; undefined when the signature (or payload) is invalid. */
  parseWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): { externalRef: string; result: ScanResult } | undefined;
}

/**
 * MOCKED sample body measurements (inches) by measurement code, so the whole flow can be tested
 * without a provider. Not real data; never used in production (env validation refuses it).
 */
const MOCK_SAMPLE_INCHES: Readonly<Record<string, number>> = {
  bust: 36,
  waist: 32,
  hip: 41,
  long_length: 62,
  short_length: 37,
  trouser_length: 40,
  chest: 41,
  shoulder: 18,
  sleeve: 25,
  top_length: 33,
  thigh: 25,
  width: 41,
  agbada_length: 44,
  head_circumference: 22,
};
/** MOCK value for a measurement code the table above does not know. */
const MOCK_FALLBACK_INCHES = 30;
const MOCK_PROVIDER = 'mock';

const webhookPayload = z.object({
  externalRef: z.string().min(1).max(200),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']),
  measurements: z.record(z.string(), z.number().positive()).optional(),
  failureReason: z.string().max(500).optional(),
});

/** MOCK Body Scan adapter: deterministic sample results, HMAC-SHA256 signed webhooks. */
export function createMockBodyScanProvider(webhookSecret: string): BodyScanProvider {
  const sign = (body: Buffer): string =>
    createHmac('sha256', webhookSecret).update(body).digest('hex');
  return {
    name: MOCK_PROVIDER,
    mocked: true,

    startSession({ sessionId }) {
      return Promise.resolve({ externalRef: `mock-${sessionId}`, captureUrl: null });
    },

    fetchResult(_externalRef, measurementCodes) {
      const measurements = Object.fromEntries(
        measurementCodes.map((code) => [code, MOCK_SAMPLE_INCHES[code] ?? MOCK_FALLBACK_INCHES]),
      );
      return Promise.resolve({ status: 'COMPLETED', measurements });
    },

    parseWebhook(rawBody, signature) {
      if (signature === undefined) return undefined;
      const expected = Buffer.from(sign(rawBody));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
      try {
        const payload = webhookPayload.parse(JSON.parse(rawBody.toString('utf8')));
        const { externalRef, ...rest } = payload;
        return {
          externalRef,
          result: {
            status: rest.status,
            ...(rest.measurements && { measurements: rest.measurements }),
            ...(rest.failureReason && { failureReason: rest.failureReason }),
          },
        };
      } catch {
        return undefined;
      }
    },
  };
}

/** Header carrying the provider signature on webhook calls. */
export const BODY_SCAN_SIGNATURE_HEADER = 'x-body-scan-signature';

/** Test/dev helper: signs a MOCK webhook body. */
export function signMockWebhook(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
