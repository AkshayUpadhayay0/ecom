---
name: urban-ibile-backend
description: Engineering playbook for the Urban Ibile Express + PostgreSQL + Kysely backend and admin API. Use this skill whenever you add or change any API module, endpoint, repository, migration, or admin feature, and ALWAYS for anything touching stock/inventory, cart, Blueprint/Find My Size, returns and exchanges, checkout, delivery fees, Paystack payments, webhooks, orders and order status, email confirmations, media/video upload, secret QR pages, content blocks, localization (English/Pidgin), or audit logging - even if the user does not mention the word "skill". Covers the module layout, transaction recipes, idempotency rules, error codes and the definition of done.
---

# Urban Ibile Backend Playbook

Read `CLAUDE.md` first for the stack and non-negotiable business rules. The client's v2.0 document (`docs/requirements-v2.pdf`) is the current source of truth; where this playbook disagrees with it, the document wins. This skill is the **how**:
step-by-step recipes for building features correctly. If a recipe conflicts with `CLAUDE.md`, stop and ask.

## 1. Adding any endpoint (checklist)

1. Identify the module (`apps/api/src/modules/<module>`) and check existing code before creating anything new.
2. Define Zod schemas in `packages/shared` when the shape is used by admin/web/mobile, otherwise in the module.
3. Write layers in this order: **repository -> service -> controller -> route**.
4. Add auth middleware (`requireCustomer` / `requireAdmin`) and, for admin writes, an audit log entry.
5. Add tests (unit for service rules, integration for the route against `ecom_test`).
6. Run typecheck, lint, tests. Summarize files changed, DB impact, API impact, how to test.

Module layout:

```
modules/<name>/
  <name>.routes.ts        Express router, wires middleware + controller
  <name>.controller.ts    parse/validate, call service, return DTO. No SQL, no business rules
  <name>.service.ts       business rules, transactions
  <name>.repository.ts    Kysely queries only
  <name>.dto.ts           response shapes + mappers (never return raw rows)
  <name>.schemas.ts       Zod request schemas
  <name>.test.ts
```

Services receive repositories via constructor/factory so they can be unit-tested. Transactions: the service opens
`db.transaction().execute(async trx => ...)` and passes `trx` to repository methods.

## 2. API conventions

- Base path `/api/v1`. Public: `/api/v1/...`; admin: `/api/v1/admin/...` (separate router, admin JWT only).
- Success: `{ data: ... }`. Lists: `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
- Errors: `{ error: { code, message, details?, requestId } }`. Throw `AppError(code, httpStatus, message)`; one central handler formats it. Never leak stack traces or SQL to clients; log them with the request id.
- Money fields end in `Minor` (integers). Dates are ISO-8601 UTC.
- Pagination: `page` (default 1) and `pageSize` (default from setting `catalog.page_size` = 20, max 50).
- Language: read `Accept-Language` or `?lang=`; default `en`. Localized reads fall back to the default language when a translation row is missing. Product `name` is never localized.
- Write endpoints that must survive retries (checkout, payment initiate) require an `Idempotency-Key` header.

Error codes (extend, never rename): `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`PRODUCT_UNAVAILABLE`, `INVALID_SIZE`, `SIZE_NOT_CONFIRMED`, `BLUEPRINT_DECISION_REQUIRED`, `BLUEPRINT_NO_RECOMMENDATION`, `RETURN_NOT_ELIGIBLE`, `RETURN_ALREADY_OPEN`, `EVIDENCE_REQUIRED`, `QR_ACCESS_DENIED`, `INSUFFICIENT_STOCK`, `CART_EMPTY`,
`INVALID_DELIVERY_ZONE`, `RESERVATION_EXPIRED`, `PAYMENT_FAILED`, `PAYMENT_VERIFICATION_FAILED`,
`DUPLICATE_REQUEST`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## 3. Recipe: reserve stock (checkout)

Run inside ONE transaction. Sort variant ids ascending before reserving so concurrent checkouts lock rows in the same order (prevents deadlocks).

```ts
const res = await trx
  .updateTable('product_variants')
  .set((eb) => ({ stock_reserved: eb('stock_reserved', '+', qty) }))
  .where('id', '=', variantId)
  .where('is_active', '=', true)
  .where(sql<number>`stock_on_hand - stock_reserved`, '>=', qty)
  .executeTakeFirst();
if (Number(res.numUpdatedRows) === 0) throw new AppError('INSUFFICIENT_STOCK', 409, '...');
```

Never read stock, check in JS, then write. The DB `CHECK (stock_reserved <= stock_on_hand)` is the last line of defence, not the first.

## 4. Recipe: create order (checkout)

Transaction steps:
1. Require `Idempotency-Key`. If an order already exists for `(customer_id, idempotency_key)`, return it (do not create another).
2. Load the customer's active cart; reject if empty (`CART_EMPTY`).
3. For each line: load variant + product; reject inactive/archived (`PRODUCT_UNAVAILABLE`) or inactive size (`INVALID_SIZE`). Each cart line must carry its `blueprint_decision_id`; copy it onto `order_items` (the DB checks it matches the variant and the customer). Never recompute a decision at checkout.
4. Price from the DB (`products.price_minor`), never from the client. Compute subtotal.
5. Load the delivery zone; it must be `is_active` with a non-null fee (`INVALID_DELIVERY_ZONE`). Fee comes from the zone row, never from the client.
6. Reserve stock (recipe 3). Insert `stock_reservations` with `expires_at = now + checkout.reservation_minutes`.
7. Insert `orders` (status `pending_payment`, payment `unpaid`, snapshot contact + address + zone name) and `order_items` (snapshot name, clothing type, size label, sku, unit price, line total).
8. Insert `order_status_history`. Mark the cart `converted` only AFTER payment succeeds (a failed payment must not lose the cart).

## 5. Recipe: Paystack payment

**Initiate** (`POST /payments/initiate`, customer must own the order, order must be `pending_payment` and reservation unexpired):
- Create a `payments` row (`initiated`) with a NEW unique `reference` (e.g. `UI-<orderNumber>-<random>`). A retry after failure creates a new row; never reuse a reference.
- Call Paystack `POST /transaction/initialize` with `email`, `amount` (= `orders.total_minor`, NGN minor units/kobo), `reference`, `callback_url`. Return `authorization_url` + `reference` to the client.
- If the reservation expired, try to re-reserve first; if stock is gone return `INSUFFICIENT_STOCK` and keep the cart.

**Verify** (`GET /payments/verify?reference=` after the redirect/in-app browser closes) and **Webhook** (`POST /webhooks/paystack`) both call the SAME function: `finalizePayment(reference)`.

Webhook specifics:
- Mount the route with `express.raw({ type: 'application/json' })` BEFORE the JSON body parser so the raw bytes are available.
- Verify `x-paystack-signature` = HMAC-SHA512 of the raw body with the Paystack secret key (timing-safe compare). Invalid signature: store the event with `signature_valid=false`, return 401, do nothing else.
- Insert into `payment_webhook_events` with the unique `(provider, provider_event_key)`; on conflict return 200 without reprocessing. Respond 200 quickly; heavy work after.

`finalizePayment(reference)` (idempotent, one transaction):
1. Call Paystack `GET /transaction/verify/:reference` (never trust the client or the webhook body alone).
2. `SELECT ... FROM orders WHERE id = :id FOR UPDATE`. If `payment_status = 'paid'`: return the order (already done).
3. Check: Paystack status `success`, amount equals `orders.total_minor`, currency matches, reference matches. Any mismatch: mark the payment `failed`, log, leave the order unpaid (`PAYMENT_VERIFICATION_FAILED`).
4. Mark payment `success` (the partial unique index guarantees one success per order), store `raw_verify_payload`, `verified_at`, `paid_at`.
5. Commit stock: for each held reservation `stock_on_hand -= q` and `stock_reserved -= q`, reservation -> `committed`, append `stock_movements` (`sale`).
6. Order -> `payment_status = 'paid'`, `paid_at`, status `being_prepared` (Assumption: confirm with client), write `order_status_history`, mark cart `converted`.
7. Insert one `email_outbox` row (`order_confirmation`; unique index prevents duplicates).

Edge case: payment succeeded but the reservation had already expired and stock is gone. Never drop the money silently: keep the payment `success`, flag the order for admin review (add a `payment_review` row to `order_statuses` via migration if not present) and notify admins. Refund handling is a Pending Client Decision.

Failed payment: payment -> `failed`, order stays `pending_payment`/`payment_failed`, reservation kept until expiry, cart untouched, customer can retry.

## 6. Recipe: reservation expiry job

Every minute (in-process timer; Redis/BullMQ is not required now, so do not add it): in a transaction select `held` reservations past `expires_at` with `FOR UPDATE SKIP LOCKED`, decrement `stock_reserved`, mark `released`, append `stock_movements` (`reservation_release`), set unpaid orders to `cancelled` with `cancel_reason = 'reservation_expired'`. Safe to run on multiple workers.

## 7. Recipe: admin order status change

- Only statuses where `order_statuses.is_admin_selectable` is true. Order must be `payment_status = 'paid'`.
- Transaction: update `orders.order_status` (+ `delivered_at` when delivered), insert `order_status_history` (admin id), insert `admin_audit_logs` with before/after.
- Allowed flow (service-level): `being_prepared -> sent_out -> delivered`. Do not allow skipping backwards without an explicit rule from the client.

## 8. Recipe: stock adjustment (admin)

Transaction: `UPDATE product_variants SET stock_on_hand = :new WHERE id = :id AND :new >= stock_reserved`. If it affects 0 rows return a clear message ("cannot set stock below reserved units"). Always append `stock_movements` (`adjustment`/`restock`) with the admin id and note. Never edit stock without a ledger row.

## 9. Recipe: secret QR pages (Option 2) and content blocks

- 8 rows exist in `qr_pages`; never hard-code 8. No create/delete endpoint, **no admin endpoint to edit secret-page content or slugs/tokens**. Developers change `qr_page_translations` by script/migration.
- Provisioning (CLI `pnpm qr:provision`, run once): for each page generate a random token (>=32 bytes), store only its SHA-256 in `access_token_hash`, write the printable QR image files (labelled `QR-1.png` ... `QR-8.png`) to a local output folder that is git-ignored, then set `token_locked_at` at print handover. If the token must be regenerable, derive it from a server secret with HMAC (decide with the team); never log tokens.
- Scan flow: `GET /api/v1/secret/scan/:token` (rate-limited) -> hash token -> find published page -> create `qr_access_grants` (random grant value in an HttpOnly, Secure, SameSite cookie; only its hash stored; TTL from `qr.grant_ttl_minutes`) -> log `qr_access_events` -> return the stable page location. `GET /api/v1/secret/pages/:slug` returns localized content ONLY with a valid unexpired, unrevoked grant for that same page, else 404 (do not reveal existence). A copied page URL in another browser has no cookie, so it fails.
- Secret pages must never appear in listings, navigation, search, sitemap or responses of other endpoints. Send `X-Robots-Tag: noindex` as a precaution only.
- Accepted limitation (client decision): a copy/screenshot of the QR works. Do not try to solve it with per-order or expiring QR codes.
- Content blocks (`home.hero`, policies, footer) are still admin-editable by language; the hero video is replaced by pointing `media_asset_id` to a new asset.

## 9b. Recipe: Blueprint (Find My Size) and decisions

- `POST /blueprint/recommend` (public, validated): body `{ productId, heightCm, weightKg, fitPreference }`. Resolve the rule set: active set for the product's `garment_cut_id`, else the active default set (`garment_cut_id IS NULL`). Find the rule with `height_min <= h < height_max`, same for weight, same fit. Return `{ recommendedSize | null, ruleVersion }` and create nothing yet. Refuse `is_sample_data` sets in production. Units: cm and kg (Assumption).
- On Add to Cart the client sends the outcome (`productId`, inputs, chosen size, mode). The server RE-RUNS the recommendation itself (never trusts a client-sent recommendation), then inserts ONE `blueprint_decisions` row: MATCHED + same size = RECOMMENDED_LOCKED; MATCHED + different size = OVERRIDE; no match = NO_MATCH/MANUAL; "I know my size" without inputs = SKIPPED/MANUAL. The cart item references that decision. Reopening Find My Size from the cart creates a NEW decision and repoints the cart line.
- Guest decisions use `guest_token`; on login claim them (set `customer_id`, the only allowed update) and merge carts.
- Rule sets are versioned: to change sizing logic create a new draft set, add rules, activate it (the old one is retired automatically in the service in one transaction). Active/retired sets and their rules are immutable.

## 9c. Recipe: Return / Exchange

- Customer: `POST /me/orders/:orderId/items/:itemId/returns` with `requestType` (RETURN|EXCHANGE), `reasonCode`, optional explanation, `quantity`, `exchangeSizeId` (EXCHANGE only), and evidence media ids. Preconditions in the service: order belongs to the customer, is paid and delivered, no open request for the item (`RETURN_ALREADY_OPEN`), and evidence present when `return_reasons.evidence_requirement = 'required'` (`EVIDENCE_REQUIRED`). Read the request window / condition rules from the active `return_policies` row; a NULL rule means "not enforced yet", never invent a default. Store `policy_id`.
- Photo evidence uses the media flow (presigned upload -> `media_assets` -> `return_request_media`). No binaries in PostgreSQL.
- Auto-classification at creation (record `fault_basis`, `fault_classified_by = 'SYSTEM'`): OVERRIDE + does_not_fit => CUSTOMER_FAULT; changed_mind => CUSTOMER_FAULT; RECOMMENDED_LOCKED + does_not_fit => REVIEW_REQUIRED; MANUAL + does_not_fit, damaged_faulty, wrong_item, other => REVIEW_REQUIRED (undefined by client). Admin may reclassify (writes `return_request_events` and `admin_audit_logs`). Set `reverse_logistics_payer` only from a confirmed rule; otherwise leave UNDECIDED.
- Admin review view must show: customer, order, exact item, product, purchased size, type, reason, explanation, evidence, Blueprint recommended vs selected size and mode, fault classification, status, decision, notes, timestamps.
- Status changes go through `return_statuses`; every change writes `return_request_events`. Refund execution is NOT built (policy pending).

## 10. Recipe: media (video) upload and replacement

1. Admin requests an upload: API validates type/size, creates `media_assets` (`pending`), returns a short-lived presigned R2 URL. Files never stream through the API.
2. Client uploads directly to R2, then calls `complete`. API enqueues the processing job.
3. Worker (FFmpeg): create small muted MP4/WebM loop renditions + poster image, write `media_renditions` with versioned keys, set `processing_status = 'ready'`.
4. Replacing a video = new asset, then repoint `products.video_asset_id` / `content_blocks.media_asset_id`. Never overwrite old keys (CDN caching). Old assets are retained until a cleanup job decides otherwise.
5. Public catalog responses return the poster URL + rendition URLs only for `ready` assets.

## 11. Recipe: catalog and search

- Shop list: `status = 'active'`, order by `display_order, id`, 20 per page. Return poster + video URL + name + price. Do not return more than the page needs.
- Search: whole catalog, not the current page. Match product `name`, `search_keywords`, clothing type translated name and `search_keywords` using `ILIKE` with the trigram indexes (escape `%` and `_` in user input). Same paging as the shop. Empty result: the API returns an empty list and the clients show the localized `search.no_results` string.
- Enforce the 100 active-product cap (`catalog.max_active_products`) in the service when activating or creating products.

## 12. Auth rules

- Passwords: argon2id. Minimum length and common-password check. Never log passwords or tokens.
- Access token ~15 min; refresh token random, stored only as a hash in `auth_sessions`, rotated on each use; reuse of a revoked token revokes the whole session family.
- Lockout: increment `failed_login_count`, set `locked_until` after the configured threshold; same generic error for unknown email and wrong password.
- Customer and admin tokens are different audiences; an admin route must reject a customer token and vice versa.
- Rate-limit login, register, password reset and verification endpoints more strictly than the rest.

## 13. Audit logging

Every admin write (products, variants, prices, stock, content, QR, zones, settings, order status) writes `admin_audit_logs` with admin id, action, entity, before/after JSON, IP. Do it in the same transaction as the change.

## 14. Migrations

The baseline is `db/schema_v2.sql`. Never edit it after it was applied. Every change is a new `db/migrations/NNNN_description.sql` that is safe to run once, written for PostgreSQL 16, and followed by regenerating Kysely types.

## 15. Anti-patterns (do not do these)

- Trusting client prices, totals, fees, or "payment succeeded" flags.
- Reading stock then writing it back; updating stock without a ledger row.
- Marking an order paid from the redirect or from an unverified webhook body.
- Business logic in controllers; SQL outside repositories; returning raw DB rows.
- Hard-coding delivery fees, sizing rules, contact details, policy text, or the Pidgin strings.
- Deleting products/orders/payments (archive instead).
- Changing a QR slug or locked token, exposing secret pages in any list, adding admin editing of secret-page content; overwriting a media file key in place.
- Recalculating an old Blueprint recommendation with newer rules; trusting a client-sent recommendation; guessing a size when no rule matches.
- Inventing a pending client decision instead of making it configurable and labelling it.

## 16. Definition of done

- [ ] Layers respected; DTOs returned; Zod validation on every input
- [ ] Auth + authorization correct; admin writes audited
- [ ] Transactions wrap multi-table changes; idempotent where retries can happen
- [ ] Error codes used; no secrets or stack traces leaked
- [ ] Tests written and passing (concurrency test for anything touching stock)
- [ ] Typecheck, lint, tests all green
- [ ] Anything mocked or assumed is labelled MOCK / Assumption / Pending Client Decision
- [ ] Summary lists files changed, DB/API impact, and exact commands to run and test
