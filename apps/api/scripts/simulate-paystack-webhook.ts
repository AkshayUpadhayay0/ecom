/**
 * DEV tool: sends a correctly signed Paystack webhook for one payment reference to the local API,
 * so the webhook path can be tested without a public URL.
 *
 *   pnpm payments:simulate-webhook <reference> [success|failed] [amountMinor] [currency]
 *   pnpm payments:simulate-webhook --reference UI-100001-... --outcome failed
 *   pnpm payments:simulate-webhook <reference> success --amount 100 --currency USD
 *
 * - amount / currency (MOCK only) make the provider report a different value than the order,
 *   to create an AMOUNT_MISMATCH / CURRENCY_MISMATCH payment for the admin review queue.
 * - The event is signed with PAYSTACK_SECRET_KEY (or the public MOCK key when it is unset).
 * - With PAYMENT_PROVIDER=mock the MOCK transaction is first marked paid / declined, because the
 *   API never trusts the webhook body: it verifies with the provider.
 * - With PAYMENT_PROVIDER=paystack nothing is marked: the API verifies with Paystack (test mode),
 *   so pay with a test card first, or the order simply stays unpaid.
 * Refuses to run when NODE_ENV=production.
 */
import { randomInt } from 'node:crypto';
import { paymentReferenceSchema } from '@urban-ibile/shared';
import { pino } from 'pino';
import { API_BASE_PATH } from '../src/app.js';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { createPaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { PAYSTACK_SIGNATURE_HEADER } from '../src/modules/payments/payments.controller.js';
import { PAYSTACK_WEBHOOK_PATH } from '../src/modules/payments/payments.routes.js';
import { createMockPaymentProvider } from '../src/modules/payments/provider/mock-provider.js';
import { webhookSigningSecret } from '../src/modules/payments/provider/create-provider.js';
import { signWebhookBody } from '../src/modules/payments/provider/payment-provider.js';

const OUTCOMES = ['success', 'failed'] as const;
type Outcome = (typeof OUTCOMES)[number];
const MAX_EVENT_ID = 1_000_000_000;

interface Args {
  reference: string;
  outcome: Outcome;
  amountMinor?: number;
  currency?: string;
}

function readArgs(argv: readonly string[]): Args {
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      named.set(arg.slice(2), argv[i + 1] ?? '');
      i += 1;
    } else if (arg !== '') {
      positional.push(arg);
    }
  }
  const reference = paymentReferenceSchema.safeParse(named.get('reference') ?? positional[0]);
  const outcome = named.get('outcome') ?? positional[1] ?? 'success';
  const amount = named.get('amount') ?? positional[2];
  const currency = named.get('currency') ?? positional[3];
  const amountMinor = amount === undefined ? undefined : Number(amount);
  const validAmount =
    amountMinor === undefined || (Number.isSafeInteger(amountMinor) && amountMinor > 0);
  const validCurrency = currency === undefined || /^[A-Z]{3}$/.test(currency);
  if (
    !reference.success ||
    !OUTCOMES.includes(outcome as Outcome) ||
    !validAmount ||
    !validCurrency
  ) {
    throw new Error(
      'Usage: pnpm payments:simulate-webhook <reference> [success|failed] [amountMinor] [currency]',
    );
  }
  return {
    reference: reference.data,
    outcome: outcome as Outcome,
    ...(amountMinor !== undefined && { amountMinor }),
    ...(currency !== undefined && { currency }),
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production')
    throw new Error('Refusing to simulate webhooks in production.');
  const { reference, outcome, amountMinor, currency } = readArgs(process.argv.slice(2));

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: 1,
    logger: pino({ level: 'silent' }),
  });
  const payment = await createPaymentsRepository().findByReference(db, reference);
  await db.destroy();
  if (!payment) throw new Error(`No payment with reference ${reference} in this database.`);

  if (env.PAYMENT_PROVIDER === 'mock') {
    const mock = createMockPaymentProvider({
      dir: env.MOCK_PAYMENTS_DIR,
      checkoutBaseUrl: `${env.API_PUBLIC_URL}${API_BASE_PATH}`,
      webhookSecret: webhookSigningSecret(env),
    });
    await mock.setOutcome(reference, {
      status: outcome,
      ...(amountMinor !== undefined && { amountMinor }),
      ...(currency !== undefined && { currency }),
    });
    const reported = [amountMinor && `amount ${amountMinor}`, currency && `currency ${currency}`]
      .filter(Boolean)
      .join(', ');
    console.log(
      `MOCK provider: ${reference} marked ${outcome}${reported ? ` (reports ${reported})` : ''}.`,
    );
  } else if (amountMinor !== undefined || currency !== undefined) {
    throw new Error('amount / currency overrides only work with PAYMENT_PROVIDER=mock.');
  }

  const body = JSON.stringify({
    event: outcome === 'success' ? 'charge.success' : 'charge.failed',
    data: {
      id: randomInt(1, MAX_EVENT_ID),
      reference,
      status: outcome,
      amount: amountMinor ?? Number(payment.amountMinor),
      currency: currency ?? payment.currency.trim(),
      channel: 'card',
      gateway_response: outcome === 'success' ? 'Approved (simulated)' : 'Declined (simulated)',
      paid_at: outcome === 'success' ? new Date().toISOString() : null,
    },
  });
  const url = `${env.API_PUBLIC_URL}${API_BASE_PATH}${PAYSTACK_WEBHOOK_PATH}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [PAYSTACK_SIGNATURE_HEADER]: signWebhookBody(body, webhookSigningSecret(env)),
    },
    body,
  });
  console.log(`POST ${url} -> ${res.status}`);
  console.log(await res.text());
  if (!res.ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  const message =
    err instanceof EnvValidationError || err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
