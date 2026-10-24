# Urban Ibile - Project Rules for Claude Code

You are the lead engineer on Urban Ibile, a premium video-first fashion e-commerce platform.
Read this file fully before every task. Source documents live in the repo:

- `docs/backend-design-9oct.docx` - **CURRENT SOURCE OF TRUTH for the backend** (Backend System Design, 9 Oct 2026). Where it conflicts with anything else, it wins. Extend the existing backend; never restart it.
- `docs/requirements-v2.pdf` - client requirements v2.0 (7 Oct 2026); still valid except where the 9 Oct design replaces it (Blueprint inputs, hidden-page access)
- `docs/feature-brief.pdf` - the original Feature Brief (older; superseded where v2.0 differs)
- `db/schema_v2.sql` - baseline PostgreSQL schema (already applied to database `ecom`; never edit)
- `db/migrations/0001_auth_session_rotation.sql` - refresh-token rotation (Phase 1)
- `db/migrations/0002_requirements_v2.sql` - Return/Exchange base tables, first Blueprint design (SUPERSEDED in part by 0003)
- `db/migrations/0003_backend_design_9oct.sql` - measurement-based Blueprint, Fault-Line workflow, serial-gated hidden pages (applied by `pnpm db:migrate`; `schema_migrations` tracks every file by name + checksum)
- `db/migrations/0004_media_pipeline.sql` - media upload lifecycle columns ('uploaded' status, attempts/backoff/lease, purge) and `media.*` settings
- `db/migrations/0005_catalog_indexes.sql` - partial indexes for storefront sort orders
- `db/migrations/0006_blueprint_settings.sql` - Blueprint input limits (SAMPLE), below-chart flag (pending), Body Scan session TTL
- `db/migrations/0007_cart_checkout.sql` - `cart_items.added_unit_price_minor` (PRICE_CHANGED warning), settings `store.currency` (ASSUMPTION NGN) and `checkout.reservation_max_total_minutes` (TEAM DESIGN)
- `db/migrations/0008_payments.sql` - order status `payment_review` (money received, needs attention), payment status `needs_review`, `payments.failure_reason` / `last_checked_at`, settings `payments.reconcile_*` and `email.max_attempts` / `email.retry_base_seconds` (TEAM DESIGN)
- `db/migrations/0009_admin_orders.sql` - data-driven `order_status_transitions`, append-only `order_notes` and `payment_review_resolutions`, one status email per order/template, admin order list/search/stats indexes (Phase 7a)
- `db/migrations/0010_returns.sql` - data-driven `return_status_transitions`, status `EXCHANGE_SENT` + replacement carrier/tracking, internal/customer event visibility (append-only events), customer-owned private media (`owner_customer_id`), once-per-event email `dedupe_key`, return settings (evidence limits TEAM DESIGN; return address/instructions PLACEHOLDER) (Phase 7b)
- `db/migrations/0011_product_pending_media.sql` - `product_pending_media`: a replacement for LIVE product media waits until its new assets are ready, then the media worker swaps it in atomically (old retired, audited) (admin simplification, 19 Oct 2026)
- `db/migrations/0012_store_timezone.sql` - setting `store.timezone` (IANA, default `Africa/Lagos`, TECHNICAL RECOMMENDATION): dashboard "today / 7 / 30 days", date-only admin filters and every date shown in the admin app use it; timestamps stay UTC (super_admin only)
- `db/migrations/0013_content_text_blocks.sql` - `content_blocks.content_kind` ('video' = home.hero, 'text' = footer/policies), ensures the five public blocks exist, turns untouched seed placeholders into "Pending client content" (NULL). Text blocks: plain-text English title/body via `PUT /admin/content-blocks/:key/text` (no HTML, length-limited, audited); public `GET /site/content/:key`
- `db/migrations/0014_product_soft_delete.sql` - `products.deleted_at` / `deleted_by`, slug unique among live products only (partial index), deleted => archived. `DELETE /admin/products/:id` is a SOFT delete (blocked by unpaid orders, held stock, open returns/exchanges, pending media; removes active-cart lines, detaches media, deactivates variants; history untouched)
- `db/migrations/0015_variant_archive.sql` - `product_variants.archived_at` / `archived_by`; archived => inactive with zero stock; size-per-product and SKU unique among live variants only. `DELETE /admin/variants/:id` archives a size: blocked by reserved units / held reservations / open returns or exchanges; remaining stock written off with an `adjustment` ledger row first; active-cart lines removed; row kept for history
- `db/seeds/obsolete/seed_0002_blueprint_qr.sql` - OBSOLETE (height/weight sample rules). Not run by the seed runner.
- `db/seeds/seed_0003_charts.sql` - the client's real size charts (inches), measurement profiles, default return policy, hidden-page placeholders (`pnpm db:seed`; re-runnable)
- `db/seed_v2.sql` - seed data (sample values are flagged)

## 1. What we are building

One backend serving two customer clients (customer website - framework still PENDING, do not assume Next.js; React Native iOS+Android app) and one admin panel.
They share ONE database: products, stock, carts, orders, payments, content. Never create separate data per client.

Current phase: **backend API + admin panel**. The customer website and mobile app come later.

## 2. Tech stack (decided)

| Layer | Choice |
|---|---|
| Runtime / language | Node.js 20 or 22 LTS, TypeScript (strict) |
| API | Express |
| Database | PostgreSQL 16, database `ecom` |
| DB access | `pg` + **Kysely** (typed query builder; types generated from the live DB with kysely-codegen). Do NOT use Prisma or TypeORM: the schema is SQL-first (citext, partial indexes, triggers, CHECKs). |
| Validation | Zod (request bodies, query, params, env config) |
| Auth | argon2id password hashing; short-lived JWT access token + rotating refresh token stored hashed in `auth_sessions` |
| Logging | pino (+ pino-http), request IDs on every request |
| Security | helmet, cors (allow-list from env), express-rate-limit, input validation everywhere |
| Background work | Redis/BullMQ NOT required now (v2.0). Use DB-backed jobs: `email_outbox` polling, reservation-expiry timer using `FOR UPDATE SKIP LOCKED`. Add Redis only if a real need appears. |
| Media | Cloudflare R2 (S3 API, presigned uploads) + CDN; FFmpeg worker for renditions |
| Payments | Paystack (server-side verification + signed webhook) |
| Tests | Vitest + Supertest; real Postgres test database for integration tests |
| Admin panel | React + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui |
| Package manager | pnpm workspaces (monorepo) |

Environment is Windows. Use cross-platform scripts (no bash-only syntax in package.json scripts).

## 3. Repository layout

```
ECOM/
  CLAUDE.md
  docs/backend-design-9oct.docx, requirements-v2.pdf, feature-brief.pdf
  db/            schema_v2.sql, seed_v2.sql, migrations/ (numbered .sql, future changes)
  apps/
    api/         Express API
    admin/       React admin panel
  packages/
    shared/      Zod schemas, shared TypeScript types, constants (used by api + admin, later web + mobile)
```

API layering (strict): `routes -> controllers -> services -> repositories`.
- Controllers: parse/validate input, call a service, shape the response. NO business logic, NO SQL.
- Services: business rules, transactions, orchestration.
- Repositories: all SQL (Kysely). Nothing else touches the database.
- Return DTOs, never raw DB rows. Consistent error shape: `{ error: { code, message, details?, requestId } }`.
- Modules (one folder each under `apps/api/src/modules`): auth, customers, admin-users, catalog, media, inventory, blueprint (+ body-scan), cart, checkout, delivery, payments, orders, returns, notifications, content, hidden-pages, serial-access, localization, settings.

## 4. Non-negotiable business rules

1. **Money** is stored and computed in minor units (integers). Currency NGN (assumption). Never use floats for money.
2. **Order totals** are computed on the server from current DB prices and delivery fees. Never trust client-sent prices or totals.
3. **Inventory**: stock lives per product variant (product + size). Reserve stock with ONE conditional UPDATE inside a transaction:
   `UPDATE product_variants SET stock_reserved = stock_reserved + :q WHERE id = :id AND stock_on_hand - stock_reserved >= :q`
   Zero rows updated = insufficient stock. Never read-then-write stock. Reservations expire (setting `checkout.reservation_minutes`, default 15) and must be released by a background job.
4. **Payments**: only the server marks an order paid, and only after verifying the transaction with Paystack's API (amount, currency, reference, status). Webhook signatures (HMAC) must be verified. Webhooks and the return-redirect can both fire: processing must be idempotent (`payment_webhook_events` unique key, one `success` payment per order). Failed payments never delete the cart; retry creates a new `payments` row.
5. **Orders** snapshot name, size, price, address and zone at purchase time. Never physically delete products, orders or payments: products are archived or SOFT-deleted (`deleted_at`, hidden everywhere, history intact); orders and payments are never deleted.
6. **Order status** and **payment status** are separate. Admin-selectable statuses: Being prepared, Sent out, Delivered (lookup table `order_statuses`; more can be added later). Log every change in `order_status_history` and `admin_audit_logs`.
7. **Product names are never translated.** Product/catalogue data is canonical (no duplicate products per language). The English/Pidgin toggle covers approved static site copy only; it never changes names, prices, search terms, product identity or Blueprint logic. Do NOT build admin translation management. Approved Pidgin copy is supplied by the client's writer and applied by developers; where static copy finally lives is a team decision (keep `ui_translations` until decided).
8. **Hidden pages + serial access (9 Oct design)**: 8 hidden pages with 8 permanent QR codes today, but never hard-code 8 (the DB has no limit; `qr_pages.exclusive_only` marks the page General serials may never open, currently page 8). The QR carries only `qr_pages.route_token` to identify the page; **the QR alone never unlocks anything and the token is not a secret**. Access needs an exact serial validated against the DB: `serial_numbers` (category GENERAL or EXCLUSIVE, stored only as an HMAC-SHA256 hash keyed by env `SERIAL_HMAC_SECRET`; never plaintext, never derived from a prefix like LE/GN). A GENERAL serial unlocks exactly its one `allowed_page_id` (never an exclusive-only page); a customer can accumulate several General serials page by page. An EXCLUSIVE serial unlocks all pages. Successful validation creates a `page_access_grants` row bound to an HttpOnly cookie hash (and the customer id when logged in); copying the page URL to another browser does NOT unlock. No one-time-use, consumption or expiry rule was approved: do not mark serials used. Serial endpoint is rate-limited and returns one generic failure message for unknown, inactive or wrong-page serials. Never expose serial lists through any API. Hidden pages never appear in navigation, search, sitemaps or lists (`noindex` is only an extra). Title and body (`qr_page_translations`, default language) ARE admin-editable (decision 13 Oct 2026; audited); slugs and route tokens are NEVER editable through any endpoint. Admin can import/deactivate serials (hint only, never plaintext) in a later phase. Slugs and locked route tokens are immutable (DB trigger).
8a. **Blueprint (virtual fitting room, 9 Oct design)**: size comes from BODY MEASUREMENTS compared with the client's versioned size charts (`size_charts` / `size_chart_rows`, inches). **Weight and height are NOT inputs.** Two ways to get measurements feed ONE engine: Quick Fit (MANUAL_MEASUREMENTS) and Body Scan (BODY_SCAN, provider-neutral `body_scan_sessions`; the provider and its capture rules are a team decision: use an adapter interface with a clearly labelled MOCK adapter, never invent capture distances/poses, never store full-body images). A product's `measurement_profile_id` says which chart measurements it needs (female bust/waist/hip + relevant length; male top; male trouser; agbada body; fila head circumference; a two-piece set spans top + trouser); validate only that set. Engine: each measurement maps to the SMALLEST size whose upper bound covers it (boundary rule `SMALLEST_COVERING_SIZE`, versioned on the chart); the recommendation for the whole outfit is the LARGEST size required by any measurement (compare `sizes.sort_order`). A measurement above the chart's largest size has no size: return `BLUEPRINT_OUT_OF_RANGE` (what the customer may then do is an open question; do not invent). Fit Preference (Tailored/Standard/Oversized) is stored with the fitting record but NEVER changes the chart-derived size. The customer must lock the recommendation (LOCKED_RECOMMENDATION) or deliberately OVERRIDE it; every Add to Cart for a product with a profile needs a `blueprint_decisions` row (append-only) plus its `blueprint_measurements`, and the server re-runs the engine itself (never trusts a client recommendation). `cart_items` / `order_items` carry the decision id; order items also keep a readable `fit_snapshot`. Old decisions are never recalculated when charts change (charts are immutable once active; new version = new chart). Products with no profile do not use Blueprint.
8b. **Return / Exchange / Fault-Line (9 Oct design)**: a request starts from the exact `order_items` row and inherits its Blueprint decision. **Responsibility and workflow status are separate columns.** Responsibility (`responsibility`): CUSTOMER_FAULT, REVIEW_REQUIRED, BRAND_FAULT; BLUEPRINT_FAILURE etc. are `fault_cause` values, not responsibilities. Workflow statuses (`return_statuses`): SUBMITTED, UNDER_REVIEW, AWAITING_CUSTOMER, APPROVED, REJECTED, AWAITING_RETURN, RETURN_IN_TRANSIT, RETURN_RECEIVED, EXCHANGE_PROCESSING, REFUND_PROCESSING, COMPLETED, CANCELLED. Confirmed cost rules: (A) OVERRIDE + does_not_fit => CUSTOMER_FAULT, customer pays return dispatch; (B) LOCKED_RECOMMENDATION + genuine fit failure confirmed after review => BRAND_FAULT with cause BLUEPRINT_FAILURE, brand authorises free return/replacement and bears the cost; (C) correct size + changed_mind => CUSTOMER_FAULT, customer pays 100% of reverse logistics. A locked-recommendation fit complaint starts as REVIEW_REQUIRED. Wrong item / damaged start as REVIEW_REQUIRED (photo evidence required) and become BRAND_FAULT once confirmed. The backend decides responsibility; the client never sends it. Admin actions: Approve, Reject, Request More Information (-> AWAITING_CUSTOMER; the customer adds evidence and the SAME request returns to UNDER_REVIEW). Evidence photos are PRIVATE media (DB enforced). Exchange: store the replacement variant, check replacement stock and reserve it through `stock_reservations.return_request_id` (same reservation mechanism), linked to the original request and item. A returned item is NOT sellable until an admin inspects it (`inspection_outcome`); only RESELLABLE items are restocked, via a `stock_movements` row of type `return` (DB guard enforces this). Return-policy values (window, condition, tags, refund procedure) are TEAM DESIGN: read `return_policies`, never hard-code. Refund execution is not built yet.
9. Customers browse and search publicly. The Blueprint, cart, checkout and payment require an authenticated customer (fitting records, carts, orders and returns belong to the account). Guest carts are not used (Assumption: confirm); `carts.guest_token` stays unused.
9a. **No hard-coded catalogue size**: the shop shows 20 per page, but there is no maximum of 100 products or 5 pages. `catalog.max_active_products` is NULL (no cap) unless the client sets one.
10. Search covers the whole catalog (name, clothing type, keywords), not just the current page. Empty result message: `No outfits found. Try another word.` Shop pages show 20 products per page.
11. Never hard-code delivery fees, size rules, contact details, palette or policy text. They are configurable data.
12. Secrets (DB password, JWT secrets, Paystack keys, R2 keys) come from environment variables only. Never commit `.env`; keep `.env.example` current.
13. **Admin roles (decision 19 Oct 2026; enforced by the API with `requireAdminRole`, never only by hiding UI).** The client's staff are role `admin`; developers are `super_admin`. A restricted route called by a normal admin answers 403 (private media it may not see: 404). Every admin write is audited whoever makes it; restricting who can VIEW the Audit Log never stops recording.

    | Area | `admin` | `super_admin` |
    |---|---|---|
    | Dashboard, Orders (status, notes), Returns (all actions incl. responsibility / cause / payer, note required), Payment review (read + resolve, note required), Customers (read), Products, Inventory, Content (hero video; plain-text English footer/policy blocks; publish), Delivery | yes | yes |
    | Media Library + product-form media (decision 22 Oct 2026): browse `GET /admin/media` (Used by, `unused` filter), detail, preview URL, PUBLIC upload, complete, retry, picker, usage and delete (`DELETE /admin/media/:id`: detach everywhere + retire; files kept until a super_admin purge; blocked while processing or used by a hidden page). For BOTH roles these reach public media no customer owns only: private files / return evidence are never listed and are 404 by id (evidence only through return requests) | yes | yes (same public-only scope) |
    | `GET /admin/sizes`, `GET /admin/measurement-profiles` (product form) | yes | yes |
    | Settings: `GET` all; `PATCH` only `ADMIN_EDITABLE_SETTING_KEYS` (support.email/phone/whatsapp, social.links, returns.return_address/instructions) | yes | every key |
    | Customer suspend / enable | 403 | yes |
    | Physical media purge (`POST /admin/media/:id/purge`, `/media/purge-retired`) | 403 | yes |
    | Internal: Sizes & Charts (`PUT /sizes/order`, chart groups / versions / grids), QR Pages (`/admin/hidden-pages*` incl. content edit), serial import / batches / deactivate, Audit Log | 403 | yes |
    | Stats: `failedMediaJobs` | omitted | included |

    Every route registered under `/admin` MUST be listed with its rule in `apps/api/test/admin-role-matrix.ts`; `admin-role-matrix.test.ts` fails otherwise and proves each rule over HTTP (role admin 403 on super_admin routes, customer token 401 everywhere). `scripts/role-check.ps1` runs the same checks against a live API with real accounts.

## 5. Information status labels

When you document or discuss a decision, label it: Confirmed Requirement / Technical Recommendation / Assumption / Pending Client Decision.
Do NOT invent pending items. Use configurable structures and clearly marked sample data:

Pending from the client: ALL General serial numbers, ALL Exclusive/Limited serial numbers, final write-ups for the 8 hidden pages, approved Pidgin copy, Jumia Logistics / delivery arrangement details (do NOT build a Jumia integration from assumptions; keep delivery flexible), support email/phone/WhatsApp and social links (content, not a backend blocker). Also still open: brand colour palette, delivery fees/areas/timing, email provider, hosting provider, customer website framework.
Team-side decisions (not client blockers): Body Scan provider/SDK, video upload limits/formats, return-policy values and refund procedure, hidden-page grant persistence/TTL (browser cookie vs account), where static English/Pidgin copy lives, when exchange replacement stock is reserved (proposal: at APPROVED), what a customer may do when measurements exceed the chart, serial input tolerance (exact match + trim only today).
Security housekeeping: never commit credentials, keys, `.env` files or screenshots of passwords (`.gitignore` blocks the common patterns; `docs/` images need `git add -f`). A credential that was ever committed must be rotated (admin accounts: `pnpm admin:reset-password --email <email>`, which revokes every session and is audited). Git history is never rewritten without the owner's decision.

## 6. Code quality

- TypeScript strict, no `any` without a comment explaining why.
- Small focused functions, meaningful names, no magic numbers (use config/constants/settings).
- Every endpoint: validation, auth/authorization, proper HTTP status codes, consistent errors, logging.
- Database changes after the baseline go in `db/migrations/NNNN_description.sql` (never edit schema_v2.sql after it has been applied; add a migration).
- Anything mocked or temporary must be labelled `MOCK` or `TEMP` in code and in your summary.
- Do not rewrite unrelated modules. If you find an architecture problem, explain it and propose the safest fix before making a breaking change.

## 7. Testing

Write tests with each feature. Critical areas need strong coverage: auth, inventory reservation (including concurrent purchases), checkout, payment verification, duplicate webhooks, order status changes. Integration tests run against a separate Postgres database (`ecom_test`), never `ecom`.

## 8. How to work

1. For each task, first state a short plan (files to create/change, DB impact, API impact, risks) and wait for approval on big features.
2. Work in small phases. After each phase: run typecheck, lint and tests, summarize what changed, list how to run and test it, and stop.
3. Ask when a requirement is ambiguous instead of silently choosing a business rule.
4. Commit per phase with a clear message (do not push unless asked).

## 9. Build roadmap (do one phase at a time, only when asked)

- Phase 0: monorepo scaffold, config, DB connection + codegen, logging, error handling, health check, test setup
- Phase 1: auth (customer register/login/refresh/logout/email verification/lockout; admin login; `admin:create` CLI)
- Phase 2: admin API - clothing types, sizes, products (canonical, incl. `measurement_profile_id`), variants/stock with ledger, delivery zones (kept flexible), settings, hero/product media assignment, audit-log viewer. NO translation management, hidden-page content editing comes in Phase 2b (slugs/tokens never), NO cap on product count.
- Phase 2b (after 0003 is applied): admin read-only endpoints for size charts/profiles; serial import (CSV -> HMAC hash, batch record, audit log), serial deactivate, General-serial page pairing
- Phase 3: media pipeline - R2 presigned upload, asset records, FFmpeg renditions, replace-video flow
- Phase 4: public API - catalog (20/page, no hard cap), search, product detail, content. Hidden pages: resolve route token -> locked state; unlock with serial -> access grant -> protected content (see rule 8).
- Phase 5: Blueprint (manual measurements + Body Scan adapter with MOCK provider), fitting decisions, cart (decision required when the product has a profile), delivery quote, checkout with stock reservation
- Phase 6: Paystack initiate/verify/webhook, order confirmation, email outbox worker, reservation expiry job
- Phase 7: admin orders (list, filter, detail with Blueprint snapshot, status update, notes), stock adjustments with ledger, Returns/Exchange/Fault-Line (customer request from an order item, private photo evidence, admin review: approve/reject/request info, inspection and restock, exchange reservation)
- Phase 8: admin panel UI (React) over the admin API, module by module
- Phase 9: load testing (target 5,000 concurrent users), security review, deployment config

## 10. Known launch blockers

Do not go live until each of these is resolved (status labels as in section 5):

1. **Refresh-token rotation grace window** (Technical Recommendation, needs a decision). The API revokes the whole session when a rotated refresh token is presented again. The website's BFF serialises refreshes inside ONE process only, so run a single web instance until the API accepts the previous refresh token for a few seconds after rotation. See `docs/web-auth-bff.md`.
2. **Real delivery zones and fees** (Pending Client Decision). Only sample data exists; `pnpm seed:demo` adds one active "Sample zone (temporary)" with a SAMPLE fee plus 24 demo products (see `docs/demo-data.md`) and `pnpm seed:demo:remove` removes them. Checkout cannot go live without real areas, fees and timings (and no Jumia integration is built from assumptions).
3. **Email provider** (Pending Client Decision). Only the MOCK `log` provider exists; the API refuses it in production, so verification, reset and order emails need a real provider first.
4. **Pidgin copy** (Pending Client Decision). `packages/i18n` has an empty `pcm` file; the switcher stays off (`NEXT_PUBLIC_ENABLE_PIDGIN=false`) until the client's writer supplies approved copy. Never machine-translate.
5. **Final sizing chart** (Pending Client Decision). The seeded charts and measurement profiles are TEAM DESIGN built from the client's examples; the tailor must confirm them, together with the out-of-range handling and the wording for choosing a different size (`fms.other.*`, Pending Client Wording).
6. **r2.dev public media URL is development only** (Technical Recommendation). The bucket's `pub-*.r2.dev` URL is rate-limited and gives no caching control. Production must serve media from a custom domain on the bucket behind the Cloudflare CDN: set it as `R2_PUBLIC_BASE_URL` (API) and `NEXT_PUBLIC_MEDIA_BASE_URL` (web) and rebuild the web app. See `docs/web-media.md`.
