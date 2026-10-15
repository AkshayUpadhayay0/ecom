import * as crypto from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentProviderError,
  isValidWebhookSignature,
  signWebhookBody,
} from './payment-provider.js';
import { createPaystackProvider } from './paystack-provider.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = 'sk_test_stub_secret_not_real';
const REFERENCE = 'UI-100001-0123456789abcdef0123456789abcdef';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

describe('Paystack provider (against a local stub server)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  const seen: { method: string; url: string; auth: string | undefined; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          auth: req.headers.authorization,
          body,
        });
        handler(req, body, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });

  beforeEach(() => {
    seen.length = 0;
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const provider = (overrides: Partial<{ timeoutMs: number; verifyRetries: number }> = {}) =>
    createPaystackProvider({
      secretKey: SECRET,
      baseUrl,
      timeoutMs: 2000,
      verifyRetries: 2,
      ...overrides,
    });

  it('initializes with amount in kobo, reference, callback and id-only metadata', async () => {
    handler = (_req, _body, res) => {
      json(res, 200, {
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/abc', reference: REFERENCE },
      });
    };
    const result = await provider().initialize({
      reference: REFERENCE,
      email: 'ada@example.com',
      amountMinor: 1_750_000,
      currency: 'NGN',
      callbackUrl: 'http://localhost:3000/return',
      metadata: { orderId: 'o-1', orderNumber: 'UI-100001' },
    });
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/transaction/initialize',
      auth: `Bearer ${SECRET}`,
    });
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
      email: 'ada@example.com',
      amount: 1_750_000,
      currency: 'NGN',
      reference: REFERENCE,
      callback_url: 'http://localhost:3000/return',
      metadata: { orderId: 'o-1', orderNumber: 'UI-100001' },
    });
  });

  it('never retries initialize (it could create two transactions)', async () => {
    handler = (_req, _body, res) => {
      json(res, 503, { status: false });
    };
    await expect(
      provider().initialize({
        reference: REFERENCE,
        email: 'a@example.com',
        amountMinor: 100,
        currency: 'NGN',
        callbackUrl: 'http://localhost:3000/r',
        metadata: { orderId: 'o', orderNumber: 'n' },
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    expect(seen).toHaveLength(1);
  });

  it('maps a verified transaction (metadata as object or string)', async () => {
    for (const metadata of [{ orderId: 'o-1' }, JSON.stringify({ orderId: 'o-1' })]) {
      handler = (_req, _body, res) => {
        json(res, 200, {
          status: true,
          data: {
            id: 4099,
            status: 'success',
            reference: REFERENCE,
            amount: 1_750_000,
            currency: 'ngn',
            channel: 'card',
            gateway_response: 'Approved',
            paid_at: '2026-10-16T10:00:00.000Z',
            metadata,
            customer: { email: 'ada@example.com' },
            authorization: { last4: '4081', bin: '408408' },
          },
        });
      };
      const tx = await provider().verify(REFERENCE);
      expect(tx).toEqual({
        reference: REFERENCE,
        status: 'success',
        amountMinor: 1_750_000,
        currency: 'NGN',
        transactionId: '4099',
        channel: 'card',
        gatewayResponse: 'Approved',
        paidAt: new Date('2026-10-16T10:00:00.000Z'),
        metadataOrderId: 'o-1',
      });
    }
    expect(seen[0]?.url).toBe(`/transaction/verify/${REFERENCE}`);
  });

  it('normalises Paystack states and returns null for an unknown reference', async () => {
    for (const [paystack, ours] of [
      ['failed', 'failed'],
      ['reversed', 'failed'],
      ['abandoned', 'abandoned'],
      ['ongoing', 'pending'],
    ] as const) {
      handler = (_req, _body, res) => {
        json(res, 200, {
          status: true,
          data: { status: paystack, reference: REFERENCE, amount: 1, currency: 'NGN' },
        });
      };
      expect((await provider().verify(REFERENCE))?.status).toBe(ours);
    }
    handler = (_req, _body, res) => {
      json(res, 400, { status: false, message: 'Transaction reference not found' });
    };
    expect(await provider().verify(REFERENCE)).toBeNull();
  });

  it('retries verify (a safe read) on 5xx, a bounded number of times', async () => {
    let calls = 0;
    handler = (_req, _body, res) => {
      calls += 1;
      if (calls < 3) json(res, 502, {});
      else
        json(res, 200, {
          status: true,
          data: { status: 'success', reference: REFERENCE, amount: 5, currency: 'NGN' },
        });
    };
    expect((await provider().verify(REFERENCE))?.status).toBe('success');
    expect(calls).toBe(3);

    calls = 0;
    handler = (_req, _body, res) => {
      calls += 1;
      json(res, 500, {});
    };
    await expect(provider({ verifyRetries: 1 }).verify(REFERENCE)).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
    expect(calls).toBe(2);
  });

  it('times out instead of hanging', async () => {
    handler = () => {
      /* never answers */
    };
    await expect(
      provider({ timeoutMs: 1000, verifyRetries: 0 }).verify(REFERENCE),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('checks webhook signatures with HMAC-SHA512 and a timing-safe comparison', () => {
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { reference: REFERENCE } }),
    );
    const signature = signWebhookBody(body, SECRET);
    const timingSafeEqual = vi.mocked(crypto.timingSafeEqual);
    timingSafeEqual.mockClear();

    expect(provider().verifyWebhookSignature(body, signature)).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(provider().verifyWebhookSignature(Buffer.from(`${body.toString()} `), signature)).toBe(
      false,
    );
    expect(provider().verifyWebhookSignature(body, signWebhookBody(body, 'another-secret'))).toBe(
      false,
    );
    expect(provider().verifyWebhookSignature(body, undefined)).toBe(false);
    expect(provider().verifyWebhookSignature(body, 'not-hex!')).toBe(false);
    // Different length: refused without throwing.
    expect(isValidWebhookSignature(body, signature.slice(0, 10), SECRET)).toBe(false);
  });
});
