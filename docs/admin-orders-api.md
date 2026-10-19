# Admin orders API (Phase 7a): orders, payment review queue, customers, stats

Base path `/api/v1/admin`. Every route needs an **admin** access token (`Authorization: Bearer …`
from `POST /api/v1/admin/auth/login`). A customer token gets `401`. Errors use the usual shape
`{ error: { code, message, details?, requestId } }`. Every admin write is audit-logged in
`admin_audit_logs`, and every non-GET `/admin` request shares the `ADMIN_WRITE_RATE_LIMIT_*` limit.
Orders are never deleted.

## Roles

| Action | `admin` | `super_admin` |
| --- | --- | --- |
| Read orders, notes, customers, stats, payment review queue | ✔ | ✔ |
| Add order notes, change order status | ✔ | ✔ |
| Resolve payment reviews (`POST /payment-reviews/:id/resolve`, note required, audited; decision 19 Oct 2026) | ✔ | ✔ |
| Suspend / enable customers (`PATCH /customers/:id/status`) | `403` | ✔ |

Create a super_admin with `pnpm admin:create` (interactive; choose role `super_admin`).

## Orders

### `GET /orders`

Query parameters (all optional):

| Parameter | Notes |
| --- | --- |
| `page`, `pageSize` | Pagination; `pageSize` max 50, default `catalog.page_size`. |
| `sort` | `placedAt` (default) or `total`. |
| `order` | `desc` (default) or `asc`. |
| `orderStatus` | For example `being_prepared`. |
| `paymentStatus` | `unpaid`, `paid`, `failed`, `refunded`, … |
| `from`, `to` | ISO date or datetime. `to` is inclusive. A date-only value is a whole store day (Assumption: West Africa Time, UTC+1). |
| `deliveryZoneId` | A zone id. |
| `needsAttention` | `true` = orders in `payment_review`. |
| `q` | Order number, customer name, email or phone (2–100 characters, indexed with trigrams). |

Each row includes the status, payment status, `needsAttention`, the customer (id, name, email),
the recipient, phone, zone, total, item count, `placedAt` and `paidAt`.

### `GET /orders/:id`

The detail view returns everything in the list row, plus:

- totals, the contact details and the delivery snapshot (address, zone id and name, fee);
- carrier, tracking reference, `deliveredAt`, and cancellation details;
- **items:** name, clothing type, SKU, size, quantity, unit price and line total;
  - `fit`: the Blueprint snapshot stored at purchase (method, selection mode, fit preference, recommended and selected size);
  - `measurements`: the body measurements recorded with the decision (code, label, inches, required size);
- **payments:** every attempt, with reference, status, amount, channel, failure reason and timestamps. Raw gateway payloads are never included.
- **history:** each status change with its actor (`admin` + name, or `system`), time and note;
- **notes** and **reviewResolutions**;
- **allowedTransitions:** what an admin may change the status to right now.

### `PATCH /orders/:id/status`

```json
{ "toStatus": "sent_out", "expectedStatus": "being_prepared", "carrier": "SAMPLE Courier", "trackingReference": "TRK-123" }
```

- **Allowed changes are data**, stored in the `order_status_transitions` table. Adding a status later means inserting rows there and in `order_statuses`; no code changes.

  | From | To | Rule |
  | --- | --- | --- |
  | `pending_payment` | `being_prepared` | Order must be paid. |
  | `being_prepared` | `sent_out` | Paid. Optional `carrier` / `trackingReference`. Emails the customer. |
  | `sent_out` | `delivered` | Paid. Sets `deliveredAt`. Emails the customer. |
  | `pending_payment` | `cancelled` | **Unpaid orders only**, and `reason` is required. Releases the stock holds (ledger rows). |

- **What is not allowed:**
  - `payment_review` is never a target; those orders are resolved through the payment review queue.
  - There are no backward moves.
  - **Paid orders cannot be cancelled** here: the refund and cancellation policy is a Pending Client Decision.
- **Concurrency:** `expectedStatus` is the status the admin saw. If the order changed meanwhile, the answer is `409 ORDER_STATUS_CONFLICT` with `details.currentStatus`. When two admins send the same change, exactly one wins.
- **PAYMENT_IN_PROGRESS:** cancelling is refused with `409 PAYMENT_IN_PROGRESS` while a payment attempt for the order was started within `payments.reconcile_after_minutes` and is still unresolved. The customer may be paying at that moment. Send `"confirmInFlight": true` to cancel anyway; this is recorded in the audit log. If that payment later succeeds, the Phase 6 late-payment rules apply.
- **Errors:**
  - `409 INVALID_STATUS_TRANSITION`, with `details.allowed`;
  - `409 ORDER_NOT_PAID`;
  - `400 VALIDATION_ERROR` for a missing reason, unknown fields, or a carrier on a change other than `sent_out`.
- **Effects of each change:** an `order_status_history` row with the admin id, and an `order.status_change` audit row with before and after.
  - `sent_out` and `delivered` queue one customer email each (templates `order_sent_out` and `order_delivered`). They use an English per-language string table and the MOCK log provider in dev. A unique index allows one email per order and template.

### Notes: `GET /orders/:id/notes`, `POST /orders/:id/notes`

- **Body:** `{ "body": "Customer prefers morning delivery." }` (1–2000 characters).
- **Append-only:** a database trigger blocks editing and deleting.
- **Attributed and audited:** each note records its author and time, and writes an `order.note_add` audit row.
- **Admin only:** notes never appear in customer responses.

## Payment review queue

This queue covers payments that took money but could not be applied normally (see `docs/payments-api.md`).

| Reason | Meaning |
| --- | --- |
| `AMOUNT_MISMATCH` | The amount reported by Paystack ≠ the order total. Payment `needs_review`, order `payment_review`, holds released. |
| `CURRENCY_MISMATCH` | Different currency. Same handling. |
| `ORDER_MISMATCH` | The reference or metadata belongs to another order. Same handling. |
| `DUPLICATE_SUCCESS` | A second successful attempt for an order that is already paid. Payment `needs_review`; the order is unaffected. |
| `LATE_NO_STOCK` | Paid after the hold expired, and the stock was gone. Payment `success`, order paid + `payment_review`. |

### `GET /payment-reviews?state=open|all` and `GET /payment-reviews/:paymentId`

Each entry shows:

- the reason and payment status;
- the order (number, status, payment status, total, currency) and the customer;
- the amount and currency received (from the stored verify summary);
- `refundOwedMinor`, if a refund was recorded as owed and not yet marked refunded;
- `open`, and the resolutions made so far.

An item is **open** while the payment is `needs_review`, or paid but the order is still in `payment_review`, or a refund is recorded as owed and not yet marked refunded.

### `POST /payment-reviews/:paymentId/resolve` (any admin; was super_admin until 19 Oct 2026)

A `note` is always required.

```json
{ "action": "FULFIL", "note": "Restocked, shipping" }
{ "action": "MARK_REFUND_REQUIRED", "amountMinor": 1750000, "note": "Customer will be refunded" }
{ "action": "MARK_REFUNDED", "refundReference": "Paystack refund 12345", "note": "Refunded in dashboard" }
```

- **FULFIL** is allowed only for `LATE_NO_STOCK`, or for `AMOUNT_MISMATCH` where the amount received covers the order total in the same currency. Otherwise: `409 REVIEW_ACTION_NOT_ALLOWED`.
  - Stock is taken from what's available with the same conditional UPDATE used everywhere, all or nothing. If stock is gone: `409 INSUFFICIENT_STOCK`, and nothing is applied (no resolution, no ledger rows, order unchanged).
  - **On success:**
    - the payment becomes `success`;
    - the order becomes paid + `being_prepared`, with `sale` ledger rows;
    - the purchased quantities leave the customer's cart and the confirmation email is queued;
    - a history row is written with the admin id.
  - **Overpayment:** if the amount received exceeds the total, a `MARK_REFUND_REQUIRED` entry for the excess is recorded automatically, and the item stays open until it is marked refunded.
- **MARK_REFUND_REQUIRED** records that a manual refund is owed. The amount can be at most the amount received. The order stays out of fulfilment, and a history note is written. It can be recorded only once per payment.
- **MARK_REFUNDED** records a refund done manually in the Paystack dashboard (`refundReference` text):
  - **Unfulfilled order** (`payment_review`): the payment becomes `refunded`; the order becomes `cancelled` (`cancel_reason = refunded_after_payment_review`, payment status `refunded` if it was paid); any remaining holds are released with ledger rows.
  - **`DUPLICATE_SUCCESS`:** the payment becomes `refunded`; the order, paid by its other attempt, is untouched.
  - **Overpaid fulfilled order:** the partial refund is recorded; the payment and order are unchanged. A refund owed must be recorded first.
- **Repeats:** an action that was already recorded, or any action after `MARK_REFUNDED`, gets `409 REVIEW_ALREADY_RESOLVED`.
- **Audit and history:** every resolution writes a `payment_review_resolutions` row (append-only), a `payment_review.resolve` audit row and an order history row.

> **No automatic refunds are built.** The refund policy is a Pending Client Decision, and
> `PaymentProvider.refund()` is a stub that refuses. Admins refund manually in Paystack and record
> it here.

## Customers

- **`GET /customers`:** `?q=` searches name, email or phone; also `status`, `page` and `pageSize`. Each row has the profile, account status, whether the email is verified, the order count and the paid total.
- **`GET /customers/:id`:** the profile, preferred language, lock state, saved addresses and the latest 50 orders with totals.
- **Never returned:** password hashes, tokens or session data.
- **`PATCH /customers/:id/status`** (super_admin), body `{ "status": "suspended" | "active", "reason": "…" }`:
  - Suspending revokes every session at once, so refresh tokens stop working. An access token already issued lives at most its short TTL (`ACCESS_TOKEN_TTL_SECONDS`).
  - Login is refused while the account is suspended.
  - Audit actions are `customer.suspend` and `customer.enable`, with the reason.
  - Deleted accounts cannot be changed.

## Dashboard: `GET /stats/overview`

```json
{
  "currency": "NGN",
  "ordersByStatus": { "being_prepared": 4, "pending_payment": 2, "payment_review": 1 },
  "paid": {
    "today": { "orders": 2, "revenueMinor": 3500000 },
    "last7Days": { "orders": 6, "revenueMinor": 9800000 },
    "last30Days": { "orders": 20, "revenueMinor": 31000000 }
  },
  "ordersNeedingAttention": 1,
  "paymentsNeedingReview": 1,
  "lowStockVariants": 3,
  "outOfStockVariants": 1,
  "failedMediaJobs": 0
}
```

- **Revenue** is the sum of `total_minor` of paid orders by `paid_at`. "Today" starts at midnight store time (Assumption: WAT); 7 and 30 days include today.
- **Low stock:** active variants of non-archived products with 0 < available ≤ `low_stock_threshold`. **Out of stock:** available ≤ 0.
- **Caching:** results are cached in memory for `ADMIN_STATS_CACHE_SECONDS` (default 30).

## Schema (migration 0009)

- **New tables:**
  - `order_status_transitions` (data-driven transitions);
  - `order_notes` (append-only);
  - `payment_review_resolutions` (append-only, unique `(payment_id, action)`).
- **Email index:** a unique index on `email_outbox (order_id, template)` for the status emails.
- **New indexes:** `orders` by `placed_at`, by `(order_status, placed_at)`, by `(payment_status, placed_at)`, by `(delivery_zone_id, placed_at)`, and by `paid_at` for paid orders; `payments` by `needs_review`; trigram GIN search indexes on `orders` and `customers`.

## Pending Client Decisions

- Refund policy, covering late payments without stock, duplicate payments and overpayments. Today refunds are recorded only.
- Cancellation of paid orders: not allowed until the refund policy is decided.
- The order status after payment (`being_prepared`) is an Assumption to confirm.
- The email provider: the MOCK log provider is in use.
- Courier / logistics details: carrier and tracking are free text. No Jumia integration.
