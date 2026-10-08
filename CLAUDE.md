# Urban Ibile - Project Rules for Claude Code

You are the lead engineer on Urban Ibile, a premium video-first fashion e-commerce platform.
Read this file fully before every task. Source documents live in the repo:

- `docs/requirements-v2.pdf` - **CURRENT SOURCE OF TRUTH** (v2.0, 7 Oct 2026). Where it conflicts with the older brief, it wins. The project is NOT restarted; existing work stays unless it conflicts.
- `docs/feature-brief.pdf` - the original Feature Brief (older; superseded where v2.0 differs)
- `db/schema_v2.sql` - baseline PostgreSQL schema (already applied to database `ecom`; never edit)
- `db/migrations/0002_requirements_v2.sql` - Blueprint, Return/Exchange, 8 protected QR pages (applied by `pnpm db:migrate`; `schema_migrations` tracks it)
- `db/seeds/seed_0002_blueprint_qr.sql` - SAMPLE Blueprint rules, QR placeholders, empty return policy (`pnpm db:seed`; re-runnable)
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
  docs/feature-brief.pdf
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
- Modules (one folder each under `apps/api/src/modules`): auth, customers, admin-users, catalog, media, inventory, blueprint, cart, checkout, delivery, payments, orders, returns, notifications, content, secret-pages, localization, settings.

## 4. Non-negotiable business rules

1. **Money** is stored and computed in minor units (integers). Currency NGN (assumption). Never use floats for money.
2. **Order totals** are computed on the server from current DB prices and delivery fees. Never trust client-sent prices or totals.
3. **Inventory**: stock lives per product variant (product + size). Reserve stock with ONE conditional UPDATE inside a transaction:
   `UPDATE product_variants SET stock_reserved = stock_reserved + :q WHERE id = :id AND stock_on_hand - stock_reserved >= :q`
   Zero rows updated = insufficient stock. Never read-then-write stock. Reservations expire (setting `checkout.reservation_minutes`, default 15) and must be released by a background job.
4. **Payments**: only the server marks an order paid, and only after verifying the transaction with Paystack's API (amount, currency, reference, status). Webhook signatures (HMAC) must be verified. Webhooks and the return-redirect can both fire: processing must be idempotent (`payment_webhook_events` unique key, one `success` payment per order). Failed payments never delete the cart; retry creates a new `payments` row.
5. **Orders** snapshot name, size, price, address and zone at purchase time. Never delete products, orders or payments; archive instead.
6. **Order status** and **payment status** are separate. Admin-selectable statuses: Being prepared, Sent out, Delivered (lookup table `order_statuses`; more can be added later). Log every change in `order_status_history` and `admin_audit_logs`.
7. **Product names are never translated.** Descriptions, content and UI strings are localized (English default, Pidgin second; Pidgin text arrives later from the client's writer).
8. **Secret QR pages (v2.0, Option 2)**: exactly 8 pages / 8 permanent QR codes, but never hard-code the number 8 in code or SQL. The QR URL carries a permanent secret (only its SHA-256 is stored in `qr_pages.access_token_hash`; lock it with `token_locked_at` at print handover). Scanning a valid QR creates a short-lived, browser-bound `qr_access_grants` row (HttpOnly cookie, TTL from setting `qr.grant_ttl_minutes`); the secret page content is only served with a valid grant, so copying the page URL elsewhere does not grant access. Pages never appear in navigation, search, sitemaps or any list; send `noindex` as an extra precaution only. **Content is NOT editable from admin**: no admin endpoints for QR content; developers update `qr_page_translations` via scripts. Accepted limitation: anyone holding a copy of the QR can scan it. Slugs and locked tokens are immutable (DB trigger).
8a. **Blueprint / Find My Size (v2.0 replaces chest/waist/hip)**: inputs are height (cm), weight (kg) and fit preference (exactly Tailored, Standard, Oversized). Rules live in versioned `blueprint_rule_sets` / `blueprint_rules` (half-open ranges, DB prevents overlaps). Never invent the real mapping (tailor data is PENDING); sample sets have `is_sample_data = true` and must be refused when NODE_ENV=production. No matching rule = no recommendation: the customer chooses a size (MANUAL), never guess. Every Add to Cart creates an append-only `blueprint_decisions` row (recommended size, selected size, selection mode RECOMMENDED_LOCKED / OVERRIDE / MANUAL, rule version). `cart_items` and `order_items` reference it; old orders are NEVER recalculated with newer rules.
8b. **Return / Exchange (v2.0)**: a request is linked to the exact `order_items` row and inherits its Blueprint decision. Reasons and evidence requirements are data (`return_reasons`). Fault classification: CUSTOMER_FAULT, BRAND_FAULT, REVIEW_REQUIRED. Auto-rules supported by the client: OVERRIDE + does_not_fit => CUSTOMER_FAULT; changed_mind => CUSTOMER_FAULT; RECOMMENDED_LOCKED + does_not_fit => REVIEW_REQUIRED (admin decides; may become BRAND_FAULT / Blueprint failure). MANUAL + does_not_fit is NOT defined by the client: use REVIEW_REQUIRED and flag as Pending Client Decision. The operational policy (window, tags, unworn, refund/exchange flow, who pays reverse logistics) is TEAM DESIGN: read it from `return_policies`, never hard-code it. Refund processing is not built yet.
9. Customers must be logged in to checkout/buy. Browsing is public. Guest carts merge into the account cart on login.
10. Search covers the whole catalog (name, clothing type, keywords), not just the current page. Empty result message: `No outfits found. Try another word.` Shop pages show 20 products per page.
11. Never hard-code delivery fees, size rules, contact details, palette or policy text. They are configurable data.
12. Secrets (DB password, JWT secrets, Paystack keys, R2 keys) come from environment variables only. Never commit `.env`; keep `.env.example` current.

## 5. Information status labels

When you document or discuss a decision, label it: Confirmed Requirement / Technical Recommendation / Assumption / Pending Client Decision.
Do NOT invent pending items. Use configurable structures and clearly marked sample data:

Pending client decisions: brand colour palette, delivery fees, delivery areas and timing, Jumia Logistics arrangement (expected next week; do NOT build a Jumia integration from assumptions), support email/phone/WhatsApp, social links, tailor's Blueprint mapping and any garment-cut differences (expected next week), final content for the 8 secret pages, approved Pidgin translations, final videos, email provider, hosting provider, customer website framework.
Team design items: operational Return/Exchange policy, final video specification, return status workflow.

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
- Phase 2: admin API - clothing types, sizes, products (incl. garment cut), variants/stock, settings, delivery zones, content blocks. (NO QR content editing. Blueprint rules are loaded by developers/scripts unless the client asks for an admin screen.)
- Phase 3: media pipeline - R2 presigned upload, asset records, FFmpeg renditions, replace-video flow
- Phase 4: public API - catalog (20/page), search, product detail, content, localization. Secret pages: QR scan endpoint -> grant -> protected page content (Option 2).
- Phase 5: Blueprint recommend endpoint + decisions, cart (every item carries a decision), delivery fee quote, checkout with stock reservation
- Phase 6: Paystack initiate/verify/webhook, order confirmation, email outbox worker, reservation expiry job
- Phase 7: admin orders (list, filter, detail, status update, notes), stock adjustments with ledger, Return/Exchange (customer request from order item + photo evidence via media, admin review queue with Blueprint info and fault classification)
- Phase 8: admin panel UI (React) over the admin API, module by module
- Phase 9: load testing (target 5,000 concurrent users), security review, deployment config
