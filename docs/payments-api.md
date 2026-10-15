# Payments API (Phase 6): Paystack, order confirmation, email outbox

Base path `/api/v1`. Money is integer minor units (kobo). Errors use the usual shape
`{ error: { code, message, details?, requestId } }`.

**Confirmed Requirements**

- Paystack is the provider.
- Only a server-side verification with the provider marks an order paid. A client callback, redirect, request body or query never does.
- The amount and currency reported by Paystack must equal the order total and currency stored in the database.
- A failed payment never empties the cart; the customer can retry.
- Duplicate webhooks or callbacks never create a second payment success, stock deduction, cart clear or email.

## Endpoints

### `POST /payments/initialize` (customer login)

```json
{ "orderId": "uuid" }
```

- The body is strict: an `amountMinor`, `status` or any other field gets `400 VALIDATION_ERROR`. The amount and currency come from the order.
- The order must be the customer's own (`404` otherwise), not paid (`409 ORDER_ALREADY_PAID`), still `pending_payment` (`409 ORDER_NOT_PAYABLE`), with an unexpired stock hold (`409 RESERVATION_EXPIRED`; the customer checks out again).
- It creates a new `payments` row (`initiated`) with a server-generated, unguessable reference: `UI-<order number>-<32 hex>`.
- Each call is a new attempt (retry after a failure). The partial unique index `uq_one_success_per_order` lets at most one attempt per order ever become `success`.
- Starting an attempt extends the stock hold, within the existing cap: `min(now + checkout.reservation_minutes, placed_at + checkout.reservation_max_total_minutes)`.
- Optional `Idempotency-Key` header: repeating it for the same order returns the same attempt.
- Paystack receives the customer's email, the amount, the currency, the reference, `PAYSTACK_CALLBACK_URL` and metadata `{ orderId, orderNumber }`. Nothing else is sent.
- If Paystack is unreachable, the answer is `502 PAYMENT_PROVIDER_ERROR`; the attempt is marked `failed` (`INITIALIZE_FAILED`).

`201` response:

```json
{
  "data": {
    "reference": "UI-100001-3f0c…",
    "authorizationUrl": "https://checkout.paystack.com/…",
    "amountMinor": 1750000,
    "currency": "NGN",
    "reservationExpiresAt": "2026-10-16T10:15:00.000Z",
    "mocked": false
  }
}
```

Open `authorizationUrl` in a browser or in-app browser.

### `GET /payments/verify?reference=…` (customer login, own payment only, otherwise `404`)

The app calls this after the customer returns from Paystack.

- The server asks Paystack (`GET /transaction/verify/:reference`) and runs the confirmation routine, the same one the webhook uses.
- `200` response: `{ reference, paymentStatus, orderId, orderNumber, orderStatus, orderPaymentStatus }`.
- If Paystack is unreachable, the answer is `502 PAYMENT_PROVIDER_ERROR`; the reconciliation job tries again later.

### `POST /webhooks/paystack` (Paystack only)

- **Raw body:** this route is mounted before the JSON parser, with `express.raw()`.
- **Signature:** `x-paystack-signature` must equal the HMAC-SHA512 of the raw body keyed with `PAYSTACK_SECRET_KEY`, compared in constant time (`timingSafeEqual`).
  - Invalid or missing: `401 INVALID_SIGNATURE`.
  - It is logged with the source IP, the body size and whether a signature was present. The body and the signature value are never logged, and the event is **not stored**.
  - The route has its own rate limit (`WEBHOOK_RATE_LIMIT_*`).
- **Storage:** the event goes into `payment_webhook_events` under the unique key `event:data.id`, falling back to the reference.
  - Only non-sensitive fields are kept: id, reference, status, amount, currency, channel, gateway response and paid_at. Customer, authorization and card objects are dropped.
  - **`200` is returned only once the event is stored or recognised as a duplicate.** If storing fails, the error handler answers `5xx` so Paystack retries; the reconciliation job remains the backup.
- **Processing:** `charge.success` and `charge.failed` run the confirmation routine, which calls verify itself; the payload alone is never trusted.
  - A processing error is recorded on the event (`processing_error`) and still answered `200`, because the event is stored and reconciliation retries the payment.
  - Unknown events are stored and answered `200` with no effect.

### Order view

`GET /me/orders/:id` includes:

```json
"payment": {
  "status": "paid",
  "latestAttempt": {
    "reference": "UI-…",
    "status": "success",
    "failureReason": null,
    "channel": "card",
    "createdAt": "…",
    "paidAt": "…"
  }
}
```

It never includes raw provider payloads, card data or secrets.

## The confirmation routine

`payment-confirmation.service.ts` is used by the webhook, the verify endpoint and the reconciliation job.

1. If the payment is already final (`success`, `needs_review`, `refunded`), return it with no side effects.
2. Ask the provider (verify) **outside** any transaction. If the transaction is still pending or unknown, stop.
3. **One transaction.** Lock the customer's cart, then the order, then the payment, then reservations and variants. This is the same lock order as checkout and the expiry job, so they cannot deadlock. Re-check whether the payment is final.
4. Apply the result:

| Provider says | Effect |
| --- | --- |
| failed / abandoned | Payment `failed` (`DECLINED`) or `abandoned`. Order stays `pending_payment` with `payment_status = failed`. The cart and the hold are kept until expiry, and the customer can retry. |
| success, but the order is already paid by another attempt | Payment `needs_review` (`DUPLICATE_SUCCESS`), logged at warn level. No auto-refund. |
| success, but the amount, currency or order doesn't match | Payment `needs_review` (`AMOUNT_MISMATCH` / `CURRENCY_MISMATCH` / `ORDER_MISMATCH`). Order becomes `payment_review`; holds are released with ledger rows and a history note. **Not paid.** |
| success and everything matches | See below. |

**On a matching success:**

- **Payment:** `success`, with the transaction id, channel, `verified_at`, `paid_at` and a minimal cleaned response.
- **Order:** `payment_status = paid`, `paid_at`, order status **`being_prepared`** (Assumption: confirm with the client), and a history row.
- **Stock:** held reservations are committed. One conditional UPDATE per variant takes the quantity off both on-hand and reserved stock. The ledger gets `reservation_release` (−q) and `sale` (−q), and the reservations become `committed`.
- **Cart:** the purchased quantities are removed. The cart becomes `converted` only if it ends up empty; items added after checkout stay.
- **Email:** one `order_confirmation` row in the outbox. `uq_outbox_order_confirmation` guarantees one per order.

**Late success** (the order was cancelled, or its hold expired, before the payment arrived):

- It tries to sell from available stock with the same conditional UPDATE, all or nothing (savepoint). If it succeeds, the order is revived (`cancelled` → `being_prepared`, cancel reason cleared) and processed exactly as above.
- If stock is gone: the payment is kept (`success`), the order becomes `payment_status = paid` + **`payment_review`** ("Payment received – needs attention"), and a warning is logged.
  - Nothing is deducted or released, and there is **no auto-refund**.
  - These orders are listed for admins in Phase 7.

While a payment attempt is in flight (`initiated` and younger than `payments.reconcile_after_minutes`), the expiry job keeps the order's hold.

**Status flow:**

- **Order:**
  - `pending_payment` → `being_prepared`;
  - `pending_payment` → `cancelled` → `being_prepared` (late payment, stock available) or `payment_review` (stock gone);
  - `pending_payment` → `payment_review` (mismatch).
  - `payment_failed` exists but is not used: declined orders stay `pending_payment` for a retry.
- **`orders.payment_status`:** `unpaid` → `paid`, or `unpaid` → `failed` → `paid` on a retry.
- **`payments.status`:** `initiated` → `success | failed | abandoned | needs_review`.

## Reconciliation and emails (`pnpm worker`)

- **Reconciliation:**
  - Every loop it leases up to `payments.reconcile_batch` attempts that are still `initiated`/`pending` after `payments.reconcile_after_minutes` and weren't checked within that window. The lease uses `FOR UPDATE SKIP LOCKED` and sets `last_checked_at`.
  - Each leased attempt is verified and confirmed through the same routine, so a missed webhook never leaves a paid order unpaid. Running it twice at once is safe.
  - Attempts older than `payments.reconcile_max_age_hours` become `abandoned`. A later success is still applied, because `abandoned` is not final.
- **Email outbox:**
  - Rows are claimed with `FOR UPDATE SKIP LOCKED`, sent, and marked `sent`.
  - On failure a row is retried after `email.retry_base_seconds × attempts²` and marked `failed` after `email.max_attempts`.
  - Each send carries the outbox row id as its idempotency key.
  - The confirmation email contains the order number, items, sizes, quantities, prices, delivery fee, total and delivery address. It contains no payment data. The text is English, from a per-language string table, so Pidgin can be added later.
- **MOCKED email provider:** `EMAIL_PROVIDER=log` writes each email to the log and to `.mock-emails/<outbox id>.txt`; nothing is delivered. It is refused in production.

## MOCK provider and simulating webhooks (dev only)

- **Mock provider:** `PAYMENT_PROVIDER=mock` (the default; refused in production).
  - Initialize returns a link to the dev checkout page `GET /api/v1/payments/mock/checkout/<reference>`, which has Pay and Decline buttons.
  - The buttons only record what the provider will report. The order is confirmed only by verify, the webhook or reconciliation.
  - State lives in `.mock-payments/` (shared by the API, the worker and the script).
- **Simulate script:** `pnpm payments:simulate-webhook <reference> [success|failed]` sends a correctly signed webhook to the local API.
  - It signs with `PAYSTACK_SECRET_KEY`, or with a public MOCK key when that is unset.
  - With the mock provider it first marks the MOCK transaction paid or declined.
  - With `paystack` it only sends the webhook. The API then verifies with Paystack test mode, so pay with a test card first.

## Configuration

| Variable | Notes |
| --- | --- |
| `PAYMENT_PROVIDER` | `mock` (dev/test) or `paystack`. Production requires `paystack`. |
| `PAYSTACK_SECRET_KEY` | **Secret.** `sk_test_…` in dev, `sk_live_…` in production. Also verifies webhooks. Required in production; startup fails without it. Never logged. |
| `PAYSTACK_BASE_URL` | Default `https://api.paystack.co`. |
| `PAYSTACK_CALLBACK_URL` | **PLACEHOLDER** (`http://localhost:3000/PLACEHOLDER-checkout/return`). The storefront does not exist yet. **Must be set to the real storefront page** that receives the customer after paying and calls `GET /payments/verify`. |
| `PAYSTACK_TIMEOUT_MS`, `PAYSTACK_VERIFY_RETRIES` | Request timeout. Verify (a safe read) is retried on network errors and 5xx; initialize is never retried. |
| `PAYMENTS_RATE_LIMIT_*`, `WEBHOOK_RATE_LIMIT_*` | Rate limits for initialize/verify and for the webhook. |
| `EMAIL_PROVIDER`, `EMAIL_LOG_DIR`, `EMAIL_OUTBOX_BATCH`, `EMAIL_OUTBOX_POLL_MS` | Email outbox settings (`log` = MOCK). |

In the Paystack dashboard (Settings → API Keys & Webhooks), set the webhook URL to
`https://<api-host>/api/v1/webhooks/paystack`.

Settings (TEAM DESIGN, admin-editable):

| Setting | Default |
| --- | --- |
| `payments.reconcile_after_minutes` | 5 |
| `payments.reconcile_max_age_hours` | 48 |
| `payments.reconcile_batch` | 50 |
| `email.max_attempts` | 5 |
| `email.retry_base_seconds` | 60 |

## Pending Client Decisions

| Item | Status |
| --- | --- |
| **Refund policy** for late payments without stock (`payment_review`) and duplicate payments (`needs_review` / `DUPLICATE_SUCCESS`) | Pending Client Decision. Nothing is refunded automatically; `refund()` is a stub that refuses. Admins resolve these cases (Phase 7). |
| **Email provider** | Pending Client Decision. MOCK `log` provider in use. Production refuses to start until a real provider is added. |
| **Support contact details** (email, phone, WhatsApp) for emails and the payment-problem copy | Pending Client Decision (settings `support.*` are NULL). |
| **Currency** | Assumption: NGN (`store.currency`). Paystack amounts are in kobo. |
| **Order status after payment** (`being_prepared`) | Assumption: confirm with the client. |
| **Storefront return URL** (`PAYSTACK_CALLBACK_URL`) | Pending: depends on the customer website (framework pending). |
