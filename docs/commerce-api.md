# Commerce API (Phase 5b): addresses, cart, delivery quote, checkout, orders

Base path `/api/v1`. Every route here needs a **customer** access token
(`Authorization: Bearer …`); without one the answer is `401`. Money is always integer minor units
(kobo). Currency comes from the setting `store.currency` (**Assumption: NGN**). Errors use the usual
shape `{ error: { code, message, details?, requestId } }`.

Payment is **not** part of this phase (Phase 6). An order created here stays
`pending_payment` / `unpaid`.

## Addresses: `/me/addresses`

| Method | Path   | Notes                                                                 |
| ------ | ------ | --------------------------------------------------------------------- |
| GET    | `/`    | Own addresses, default first                                          |
| POST   | `/`    | `201`. The first address becomes the default automatically            |
| PATCH  | `/:id` | Partial update; `isDefault: true` moves the default here              |
| DELETE | `/:id` | `204`. Deleting the default promotes the oldest remaining address     |

- Body: `recipientName`, `phone`, `addressLine1`, `addressLine2?`, `city`, `state?`, `landmark?`, `label?`, `deliveryZoneId`, `isDefault?`.
- The zone must be active, otherwise `400 INVALID_DELIVERY_ZONE`.
- Another customer's address id returns `404`.
- Orders keep their own address snapshot, so editing or deleting an address never changes an order.

## Cart: `/cart`

The cart has its own rate limit (`CART_RATE_LIMIT_*`).

| Method | Path                  | Body                                             |
| ------ | --------------------- | ------------------------------------------------ |
| GET    | `/`                   | Returns the active cart (`Cache-Control: no-store`) |
| POST   | `/items`              | `{ productId, quantity, sizeId?, blueprintDecisionId? }` |
| PATCH  | `/items/:id`          | `{ quantity }`                                   |
| DELETE | `/items/:id`          | Returns the cart                                 |
| PUT    | `/items/:id/decision` | `{ blueprintDecisionId }`. A new decision ("Find My Size" reopened) can move the line to another size |

**Rules:**

- **Product with a measurement profile:** `blueprintDecisionId` is required, otherwise `409 BLUEPRINT_DECISION_REQUIRED`. The decision's selected size decides the variant. If the decision belongs to another customer or product, or does not match a `sizeId` that was sent, the answer is `409 BLUEPRINT_DECISION_INVALID`.
- **Product without a profile:** `sizeId` is required (`400 VALIDATION_ERROR`) and a decision is refused.
- **Size or product problems:** a size the product isn't made in, or an inactive variant or size, gives `409 SIZE_NOT_OFFERED`. A product that isn't active gives `409 PRODUCT_UNAVAILABLE`.
- **Quantity:**
  - the most per line is `cart.max_quantity_per_item` (setting, default 10); over it gives `409 QUANTITY_LIMIT_EXCEEDED` with `details.maxQuantity`;
  - more than is available gives `409 INSUFFICIENT_STOCK`;
  - stock counts are never returned.
- **Duplicates:** adding the same product and size again merges into one line. The newest decision wins.
- **Prices:** always read from `products.price_minor` when the cart is read. The cart never holds stock.
- **Line warnings:**

  | Warning | Meaning | Blocks checkout? |
  | --- | --- | --- |
  | `PRICE_CHANGED` | The price differs from when the line was added | No |
  | `STOCK_LOW` | Fewer units available than the quantity | Yes |
  | `OUT_OF_STOCK` | None available | Yes |
  | `UNAVAILABLE` | Inactive product, variant or size, or a missing/invalid decision | Yes; also excluded from `subtotalMinor` |

  `canCheckout` is false when the cart is empty or any line has a blocking warning.
- **Lifetime:** the cart is never emptied by checkout or by a failed payment. It is converted only when payment succeeds (Phase 6).

## Delivery

`GET /delivery/zones` lists the zones a customer can order to: active zones with a fee, in
`sort_order`. Each zone has `{ id, code, name, feeMinor, estDaysMin, estDaysMax }`.

> **SAMPLE / Pending Client Decision:** delivery areas, fees and timings are not confirmed. The
> seeded zones are SAMPLE data and inactive. An admin must create or activate a zone with a fee
> (admin API `/admin/delivery-zones`) before customers can check out. There is no Jumia
> integration.

## Quote: `POST /checkout/quote`

- Body: exactly one of `{ addressId }` (own saved address) or `{ zoneId }`.
- Returns `{ currency, subtotalMinor, deliveryFeeMinor, totalMinor, zone, canCheckout }`. The subtotal is the cart's purchasable lines at current prices; the fee comes from the zone.
- Errors:
  - unknown or inactive zone: `400 INVALID_DELIVERY_ZONE`;
  - zone with no fee yet: `409 DELIVERY_FEE_NOT_CONFIGURED`. The DB only allows a fee-less zone while it is inactive, so the fee is checked first to give the more precise code.

## Checkout: `POST /checkout/orders`

The checkout rate limit applies (`CHECKOUT_RATE_LIMIT_*`).

**Header:** `Idempotency-Key: <8-128 chars of A-Z a-z 0-9 _ . : ->`. It is required (`400 VALIDATION_ERROR`). Generate one per checkout attempt, for example a UUID, and resend the same key when retrying.

**Body:**

```json
{
  "client": "web | ios | android",
  "contactEmail": "ada@example.com",
  "contactPhone": "+2348012345678",
  "addressId": "uuid",
  "language": "en"
}
```

Send either `addressId` or `address` (the same fields as POST `/me/addresses`); a new address is saved to the account. `language` is optional: it falls back to the customer's preferred language, then the default.

**Responses:**

- `201`: a new order.
- `200`: an earlier result. Either the same key with the same payload, or your unchanged open order (see below).
- `409 IDEMPOTENCY_KEY_REUSED`: the same key with a different payload.

All of the following happens in **one transaction**. Any error rolls everything back: no order, no hold, no idempotency record, and the cart stays as it was.

1. Claim the idempotency key (`idempotency_keys`, scope `checkout.order`, SHA-256 of the canonical body). A parallel double click waits on the unique index, then receives the first request's order.
2. Lock the cart row. Re-check every line now:
   - `CART_EMPTY`;
   - `BLUEPRINT_DECISION_REQUIRED`;
   - `PRODUCT_UNAVAILABLE`;
   - `QUANTITY_LIMIT_EXCEEDED`.
3. Resolve the address (own only, otherwise `404`) and the zone (`INVALID_DELIVERY_ZONE` / `DELIVERY_FEE_NOT_CONFIGURED`).
4. **One open order per customer.** Find the existing `pending_payment` + `unpaid` order and lock it.
   - **Unchanged** (same lines, prices, decisions, address, zone, fee and contact) and still held: extend the hold to `min(now + checkout.reservation_minutes, placed_at + checkout.reservation_max_total_minutes)`. A hold is never shortened. Return the order (`200`).
   - **Otherwise:** release its stock and cancel it. The cancel reason is `superseded_by_new_checkout`, or `reservation_expired` if its hold had already run out. Write a status history row.
5. **Reserve stock.** For each line, in variant-id order, run ONE conditional update:
   `UPDATE product_variants SET stock_reserved = stock_reserved + q WHERE id = :id AND is_active AND stock_on_hand - stock_reserved >= q`.
   Zero rows updated means `409 INSUFFICIENT_STOCK` (with `details.lineId`). Concurrent buyers queue on the row lock and the condition is re-checked, so they can never hold more than the stock.
6. Insert the order. It is `pending_payment` / `unpaid`, with server totals (`total = subtotal + fee`, also a DB CHECK) and snapshots of the contact, address and zone name.
7. Insert the order items, each with snapshots of the product name, clothing type, size label, SKU and unit price, plus `blueprint_decision_id` and a readable `fit_snapshot` (method, selection mode, fit preference, recommended and selected size, chart snapshot).
8. Record the holds: `stock_reservations` (status `held`, `expires_at`), `stock_movements` of type `reservation` (+q) and an `order_status_history` row (`null -> pending_payment`, system).

Lock order everywhere is cart → order → reservations → variants (sorted), so checkout and the expiry job cannot deadlock.

**Audit:** `admin_audit_logs` requires an admin. Customer checkout events are therefore recorded in `order_status_history` (where `changed_by_admin` NULL means the system or customer), in the stock ledger, and in structured logs (order id and number only; no contact data).

## Reservation expiry

`pnpm worker` (the same process as the media worker; `pnpm worker:media` still works) runs
`releaseExpiredReservations` on every loop.

- It claims up to `RESERVATION_SWEEP_BATCH` orders that are `pending_payment`, `unpaid`/`failed` and past `reservation_expires_at`, using `FOR UPDATE SKIP LOCKED`.
- For each order it releases the holds (`reservation_release` movement, −q), marks the reservations `released`, and cancels the order (`cancel_reason = reservation_expired`) with a history row.
- It is safe to run twice or in parallel: a second run finds nothing.

## Customer orders

| Method | Path             | Notes                                                                 |
| ------ | ---------------- | --------------------------------------------------------------------- |
| GET    | `/me/orders`     | `?page=&pageSize=` (default `catalog.page_size`, max 50), newest first |
| GET    | `/me/orders/:id` | Own orders only; any other id is `404`                                |

The detail view includes items with their `fit` summary, totals, contact, the delivery snapshot,
`reservationExpiresAt` and `cancelReason`. It never includes the admin-only `internal_note`.

## Settings used

| Key | Default | Status |
| --- | --- | --- |
| `cart.max_quantity_per_item` | 10 | Team design |
| `checkout.reservation_minutes` | 15 | Confirmed (CLAUDE.md) |
| `checkout.reservation_max_total_minutes` | 45 | Team design |
| `store.currency` | NGN | Assumption |
