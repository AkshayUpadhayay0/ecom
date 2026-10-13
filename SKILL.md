---
name: urban-ibile-backend
description: Engineering playbook for the Urban Ibile Express + PostgreSQL + Kysely backend and admin API. Use this skill whenever you add or change any API module, endpoint, repository, migration, or admin feature, and ALWAYS for anything touching stock/inventory, cart, Blueprint/Find My Size, returns and exchanges, checkout, delivery fees, Paystack payments, webhooks, orders and order status, email confirmations, media/video upload, hidden pages and serial access, content blocks, localization (English/Pidgin), or audit logging - even if the user does not mention the word "skill". Covers the module layout, transaction recipes, idempotency rules, error codes and the definition of done.
---

# Urban Ibile Backend Playbook

Read `CLAUDE.md` first for the stack and non-negotiable business rules. The Backend System Design of 9 Oct 2026 (`docs/backend-design-9oct.docx`) is the current source of truth; where this playbook disagrees with it, the document wins. Extend the existing codebase: reuse existing auth, session, payment/idempotency, inventory, order, outbox and media structures; do not restart or switch to Prisma. This skill is the **how**:
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
`PRODUCT_UNAVAILABLE`, `INVALID_SIZE`, `SIZE_NOT_CONFIRMED`, `BLUEPRINT_DECISION_REQUIRED`, `BLUEPRINT_MEASUREMENTS_INVALID`, `BLUEPRINT_OUT_OF_RANGE`, `BODY_SCAN_NOT_READY`, `RETURN_NOT_ELIGIBLE`, `RETURN_ALREADY_OPEN`, `EVIDENCE_REQUIRED`, `HIDDEN_PAGE_LOCKED`, `SERIAL_NOT_VALID`, `INSUFFICIENT_STOCK`, `CART_EMPTY`,
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
3. For each line: load variant + product; reject inactive/archived (`PRODUCT_UNAVAILABLE`) or inactive size (`INVALID_SIZE`). Each cart line for a product that has a `measurement_profile_id` must carry its `blueprint_decision_id` (products without a profile do not); copy it onto `order_items` together with a readable `fit_snapshot` (method, mode, recommended and selected size labels, fit preference, chart versions). The DB checks it matches the variant and the customer. Never recompute a decision at checkout.
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

## 9. Recipe: hidden pages, QR routes and serial access (9 Oct design)

Model: QR = which page. Serial = permission. The QR route token is printed on boxes and is NOT a secret; the serial list is.

- Tables: `qr_pages` (the hidden pages; `route_token`, `exclusive_only`, developer-managed `qr_page_translations`), `serial_numbers`, `serial_import_batches`, `page_access_grants`, `qr_access_events`. Never hard-code 8; page 8 is just the row with `exclusive_only = true`.
- QR images: a CLI `pnpm qr:generate` builds `QR-1.png` ... from `route_token` (URL `https://<final-domain>/h/<route_token>`; the final domain must be decided BEFORE printing) into a git-ignored folder. Set `token_locked_at` at print handover; after that the token can never change.
- `GET /api/v1/hidden/pages/:routeToken`: unknown token -> 404. Known token: if the request's cookie/customer has a valid grant for this page return the content, otherwise return only `{ locked: true }` (no content, no title).
- `POST /api/v1/hidden/pages/:routeToken/unlock` body `{ serial }` (strict rate limit per IP and per token, plus a global limit): trim whitespace only (exact match otherwise, no case/prefix guessing; open question if tolerance is wanted). Compute `HMAC-SHA256(serial, SERIAL_HMAC_SECRET)` (env var; fail startup if missing or short) and look it up in `serial_numbers.serial_hash` where `is_active`. Authorise: GENERAL only if `allowed_page_id` = this page; EXCLUSIVE always. On success insert a `page_access_grants` row (GENERAL: scope PAGE + its page; EXCLUSIVE: scope ALL), set/refresh the browser cookie (random 32 bytes; only its hash is stored; HttpOnly, Secure, SameSite=Lax), add `customer_id` when the customer is logged in, and return the content. On any failure return the SAME generic message (unknown, inactive and wrong-page look identical) and log the real reason in `qr_access_events`.
- Grants accumulate: the same browser can hold several PAGE grants. Authorisation query: a grant for this browser hash (or this customer) that is not revoked, not expired (`expires_at` NULL = no expiry; TTL is an open team decision, setting `qr.grant_ttl_minutes`), and `scope = 'ALL' OR page_id = :page`.
- Do not mark serials used, bind them to a customer, or expire them: not approved.
- Serial import (admin, Phase 2b): CSV rows `serial, category, pageSlot (GENERAL only)`; validate everything, HMAC each serial, store `serial_hint` (masked), create a `serial_import_batches` row, write `admin_audit_logs`, all in one transaction; reject duplicates. Serials are never returned by any endpoint and never logged. The client supplies only the General and Exclusive lists; General page pairing is our setup step.
- Hidden pages never appear in navigation, search, sitemaps, lists or other responses; send `X-Robots-Tag: noindex, nofollow` as an extra. There is NO admin endpoint to edit hidden-page content, slugs or tokens.
- Content blocks (`home.hero`, policies, footer): hero video is replaced by pointing `media_asset_id` to a new asset. Static copy is not edited by admin.

## 9b. Recipe: Blueprint (virtual fitting room)

Data: `size_chart_groups`, `size_charts` (versioned, immutable once active), `size_chart_rows` (min/max inches per size and measurement), `measurement_types`, `measurement_profiles` + `measurement_profile_items` (which measurements a product needs), `body_scan_sessions`, `blueprint_decisions`, `blueprint_measurements`. Weight/height are not used anywhere.

Engine (one pure function, unit-tested with the client's real chart values):
1. Product -> `measurement_profile_id` -> required (chart group, measurement) pairs. Validate the submitted set EXACTLY (reject missing or extra codes with `BLUEPRINT_MEASUREMENTS_INVALID`). Positive numbers; convert cm to inches (round to 0.1); store inches. Plausibility bounds belong in config, not invented here.
2. For each pair load the ACTIVE chart of the group. Required size = the smallest size (by `sizes.sort_order`) whose `max_inches >= value`. Ranges may overlap between neighbouring sizes (e.g. sleeve 25 in M and L) and gaps exist (e.g. female bust 38 -> 42): this one rule resolves both. If no size covers the value return `BLUEPRINT_OUT_OF_RANGE` naming the measurement.
3. Recommended outfit size = the size with the highest `sort_order` among all required sizes (largest-required-size rule). A two-piece set yields ONE size, never separate top and trouser purchases.
4. Fit preference is recorded only. It never moves the size.

Endpoints (customer auth required):
- `POST /blueprint/recommend` `{ productId, measurements, unit, fitPreference }` (or `bodyScanSessionId`) -> recommended size, per-measurement breakdown, chart versions. Persists nothing.
- `POST /blueprint/decisions` (or the add-to-cart call) `{ same input, selectedSizeId }`: the SERVER re-runs the engine, sets mode LOCKED_RECOMMENDATION when selected = recommended else OVERRIDE, checks the selected variant is active and in stock, then in ONE transaction inserts the `blueprint_decisions` row (with `chart_snapshot` jsonb) and every `blueprint_measurements` row (chart id, value, required size). The DB verifies at commit that all required measurements exist and the recommended size is the largest required. Changing size later creates a NEW decision; never update one.
- Body Scan: `POST /blueprint/body-scans` creates a session (customer + product, status CREATED); provider callback/fetch moves it to IN_PROGRESS/COMPLETED/FAILED and stores only minimal result measurements (no images). Code against a `BodyScanProvider` interface with a clearly labelled MOCK adapter until the team picks a provider; do not invent capture distances, poses or calibration. A completed session feeds the SAME engine; the decision records method BODY_SCAN and the session id. After the decision is stored the raw result may be purged (`result_purged_at`).
- Charts and profiles are loaded by developers (seed/migration scripts). A new version = new draft chart + rows, then retire the old chart and activate the new one in one transaction. Never edit active chart rows (the DB refuses).
- Do not infer or hard-code anything not in the charts. The seeded profiles are TEAM DESIGN built from the document's examples: confirm with the tailor.

## 9c. Recipe: Return / Exchange / Fault-Line

- Customer: `POST /me/orders/:orderId/items/:itemId/returns` with `requestType` (RETURN|EXCHANGE), `reasonCode`, explanation, `quantity`, `exchangeSizeId` (EXCHANGE only), evidence media ids. The service checks: order belongs to the customer, paid and delivered, no open request for the item (`RETURN_ALREADY_OPEN`), evidence present when `return_reasons.evidence_requirement = 'required'` (wrong item and damaged: required; does not fit: optional; changed mind: none; `EVIDENCE_REQUIRED`). Read window/condition rules from the active `return_policies` row; a NULL rule means "not enforced yet", never invent a default. Store `policy_id`.
- Evidence uploads use the media flow with `visibility = 'private'` (the DB rejects public assets as evidence). Never expose evidence as a public URL; admins get short-lived signed URLs.
- Responsibility at creation (backend decides; record `fault_basis`, `responsibility_set_by = 'SYSTEM'`): does_not_fit + decision OVERRIDE => CUSTOMER_FAULT, cause CUSTOMER_OVERRODE_RECOMMENDATION, payer CUSTOMER (scenario A); changed_mind => CUSTOMER_FAULT, cause CHANGED_MIND, payer CUSTOMER (scenario C); does_not_fit + decision LOCKED_RECOMMENDATION => REVIEW_REQUIRED; wrong_item, damaged_faulty, other, and does_not_fit on a product with no Blueprint decision => REVIEW_REQUIRED (not defined by the client). After review the admin may set BRAND_FAULT with cause BLUEPRINT_FAILURE (scenario B), WRONG_ITEM_DELIVERED or DEFECTIVE_ITEM, with payer BRAND. Default payer: CUSTOMER_FAULT -> CUSTOMER, BRAND_FAULT -> BRAND, REVIEW_REQUIRED -> UNDECIDED. Responsibility is NOT the workflow status; keep both.
- Admin actions: Approve (-> APPROVED, then AWAITING_RETURN), Reject (-> REJECTED), Request more information (-> AWAITING_CUSTOMER). When the customer submits the requested evidence the SAME request returns to UNDER_REVIEW; never create a second request. Every change writes `return_request_events` and `admin_audit_logs` in the same transaction.
- Exchange: resolve and store `replacement_variant_id`; check stock and reserve with one conditional update plus a `stock_reservations` row owned by `return_request_id` (no order). Proposal (TEAM DESIGN, confirm): reserve when the request becomes APPROVED; release if it ends REJECTED or CANCELLED. The replacement stays linked to the original request and order item.
- Returned stock: at RETURN_RECEIVED an admin records the inspection (`inspection_outcome`, inspector, time, notes). Only RESELLABLE items go back to sellable stock: in one transaction increase `stock_on_hand` and append a `stock_movements` row of type `return` referencing the request (the DB refuses it otherwise, and refuses more than the returned quantity). NOT_RESELLABLE items never re-enter inventory.
- Admin review view shows: customer, order, exact item, product, purchased size, type, reason, explanation, evidence, Blueprint method / measurements / recommended vs selected size / mode / chart version, fit preference, responsibility and cause, status, payer, decision, notes, timestamps.
- Refund execution and exact return-policy values are not built (open team decision); REFUND_PROCESSING exists only as a status.

## 10. Recipe: media (video) upload and replacement

1. Admin requests an upload: API validates type/size, creates `media_assets` (`pending`), returns a short-lived presigned R2 URL. Files never stream through the API.
2. Client uploads directly to R2, then calls `complete`. API enqueues the processing job.
3. Worker (FFmpeg): create small muted MP4/WebM loop renditions + poster image, write `media_renditions` with versioned keys, set `processing_status = 'ready'`.
4. Replacing a video = new asset, then repoint `products.video_asset_id` / `content_blocks.media_asset_id`. Never overwrite old keys (CDN caching). Old assets are retained until a cleanup job decides otherwise.
5. Public catalog responses return the poster URL + rendition URLs only for `ready` assets.

## 11. Recipe: catalog and search

- Shop list: `status = 'active'`, order by `display_order, id`, 20 per page. Return poster + video URL + name + price. Do not return more than the page needs.
- Search: whole catalog, not the current page. Match product `name`, `search_keywords`, clothing type translated name and `search_keywords` using `ILIKE` with the trigram indexes (escape `%` and `_` in user input). Same paging as the shop. Empty result: the API returns an empty list and the clients show the localized `search.no_results` string.
- There is NO hard-coded product maximum or page count. `catalog.max_active_products` is NULL (no cap); enforce it only if the client later sets a number.

## 12. Auth rules

- Passwords: argon2id. Minimum length and common-password check. Never log passwords or tokens.
- Access token ~15 min; refresh token random, stored only as a hash in `auth_sessions`, rotated on each use; reuse of a revoked token revokes the whole session family.
- Lockout: increment `failed_login_count`, set `locked_until` after the configured threshold; same generic error for unknown email and wrong password.
- Customer and admin tokens are different audiences; an admin route must reject a customer token and vice versa.
- Rate-limit login, register, password reset and verification endpoints more strictly than the rest.

## 13. Audit logging

Every admin write (products, variants, prices, stock, media, zones, settings, order status, returns decisions and inspections, serial imports and deactivations) writes `admin_audit_logs` with admin id, action, entity, before/after JSON, IP. Do it in the same transaction as the change.

## 14. Migrations

The baseline is `db/schema_v2.sql`; `0001_auth_session_rotation`, `0002_requirements_v2` and `0003_backend_design_9oct` are applied on top by `pnpm db:migrate` (the runner wraps each file in a transaction and records it in `schema_migrations`, so migration files contain no BEGIN/COMMIT or bookkeeping). Re-runnable sample/reference data lives in `db/seeds/seed_NNNN_*.sql` (`pnpm db:seed`). Never edit applied files. Every change is a new `db/migrations/NNNN_description.sql` that is safe to run once, written for PostgreSQL 16, and followed by regenerating Kysely types.

## 15. Anti-patterns (do not do these)

- Trusting client prices, totals, fees, or "payment succeeded" flags.
- Reading stock then writing it back; updating stock without a ledger row.
- Marking an order paid from the redirect or from an unverified webhook body.
- Business logic in controllers; SQL outside repositories; returning raw DB rows.
- Hard-coding delivery fees, sizing rules, contact details, policy text, or the Pidgin strings.
- Deleting products/orders/payments (archive instead).
- Changing a QR slug or locked route token, exposing hidden pages in any list, adding admin editing of hidden-page content; overwriting a media file key in place.
- Using height or weight for sizing; letting Fit Preference change the chart size; recalculating an old Blueprint decision with newer charts; trusting a client-sent recommendation or responsibility.
- Deciding serial category from a prefix (LE/GN); storing or returning plaintext serials; distinguishing unknown/inactive/wrong-page serials in the API reply; marking serials used.
- Putting returned items back into stock without inspection; exposing return evidence as public files.
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
