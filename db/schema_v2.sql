-- =====================================================================
-- Urban Ibile - COMPLETE Database Schema v2  (PostgreSQL 15+)
-- Supersedes v1. Seed data lives in urban_ibile_seed_v2.sql (run after this file).
-- Legend:  [CONFIRMED] from Feature Brief | [REC] technical recommendation
--          [ASSUMPTION] needs client confirmation | [PENDING] client data, kept configurable
-- Conventions: UUID PKs, money in minor units (BIGINT), timestamptz everywhere,
--              no hard deletes on catalog/financial data (archive via status).
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fast partial-word search

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. LOCALIZATION  [CONFIRMED: English default, Pidgin toggle] [REC: extensible]
-- ---------------------------------------------------------------------
CREATE TABLE languages (
  code        text PRIMARY KEY,                 -- 'en', 'pcm'
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_languages_single_default ON languages (is_default) WHERE is_default;
INSERT INTO languages (code, name, is_default, sort_order) VALUES
  ('en','English',true,1), ('pcm','Pidgin',false,2);

-- UI strings (navigation, cart, checkout, order messages). Pidgin rows arrive later from client's writer.
CREATE TABLE ui_translations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_key text NOT NULL,                -- e.g. 'cart.empty'
  language_code text NOT NULL REFERENCES languages(code),
  value         text NOT NULL,
  is_approved   boolean NOT NULL DEFAULT false, -- Pidgin must be client-approved before launch
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (translation_key, language_code)
);

-- ---------------------------------------------------------------------
-- 2. IDENTITY: CUSTOMERS & ADMINS  [CONFIRMED: account required to buy]
-- ---------------------------------------------------------------------
CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  password_hash       text NOT NULL,            -- argon2id/bcrypt, never plaintext
  full_name           text NOT NULL,
  phone               text,
  preferred_language  text NOT NULL DEFAULT 'en' REFERENCES languages(code),
  email_verified_at   timestamptz,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  failed_login_count  int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  terms_accepted_at   timestamptz,              -- [PENDING legal text] consent record
  terms_version       text,
  anonymized_at       timestamptz,              -- set when personal data is scrubbed; row kept for order history
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh-token sessions shared by website and mobile app (one account, many devices)
CREATE TABLE auth_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('customer','admin')),
  subject_id    uuid NOT NULL,                  -- customers.id or admin_users.id (polymorphic, enforced in service layer)
  token_hash    text NOT NULL UNIQUE,           -- store hash only
  client        text NOT NULL CHECK (client IN ('web','ios','android')),
  user_agent    text,
  ip_address    inet,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_sessions_subject ON auth_sessions (subject_type, subject_id) WHERE revoked_at IS NULL;

CREATE TABLE email_verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- [CONFIRMED: 1-2 admins with own logins] [REC: role column for later growth]
CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin','admin')),
  is_active     boolean NOT NULL DEFAULT true,
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_admin_users_updated BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id           bigserial PRIMARY KEY,
  admin_id     uuid NOT NULL REFERENCES admin_users(id),
  action       text NOT NULL,                   -- 'product.update', 'order.status_change', ...
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  before_data  jsonb,
  after_data   jsonb,
  ip_address   inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON admin_audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_admin_time ON admin_audit_logs (admin_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. DELIVERY  [CONFIRMED: fee varies by location] [PENDING: fees, areas, timing, logistics]
-- ---------------------------------------------------------------------
CREATE TABLE delivery_zones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  fee_minor          bigint CHECK (fee_minor >= 0),          -- NULL = fee not yet supplied (zone not selectable)
  est_days_min       int CHECK (est_days_min >= 0),
  est_days_max       int CHECK (est_days_max >= est_days_min),
  is_active          boolean NOT NULL DEFAULT false,          -- off until client confirms
  is_sample_data     boolean NOT NULL DEFAULT false,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_active OR fee_minor IS NOT NULL)
);
CREATE TRIGGER trg_zones_updated BEFORE UPDATE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_addresses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label            text,
  recipient_name   text NOT NULL,
  phone            text NOT NULL,
  address_line1    text NOT NULL,
  address_line2    text,
  city             text NOT NULL,
  state            text,
  delivery_zone_id uuid NOT NULL REFERENCES delivery_zones(id),
  landmark         text,
  is_default       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_addresses_customer ON customer_addresses (customer_id);
CREATE UNIQUE INDEX uq_addresses_one_default ON customer_addresses (customer_id) WHERE is_default;
CREATE TRIGGER trg_addresses_updated BEFORE UPDATE ON customer_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 4. MEDIA PIPELINE  [REC: object storage + CDN, multiple renditions]
-- ---------------------------------------------------------------------
CREATE TABLE media_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('video','image')),
  original_key     text NOT NULL,                -- object-storage key of the upload
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  duration_ms      int,
  width            int,
  height           int,
  poster_asset_id  uuid REFERENCES media_assets(id),   -- poster frame for autoplay fallback / data saver
  processing_status text NOT NULL DEFAULT 'pending'
                   CHECK (processing_status IN ('pending','processing','ready','failed')),
  is_temporary     boolean NOT NULL DEFAULT false,      -- [CONFIRMED] temporary videos get replaced later
  uploaded_by      uuid REFERENCES admin_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_media_updated BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE media_renditions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  label         text NOT NULL,                  -- '360p','720p','hls_master','thumb'
  format        text NOT NULL,                  -- 'mp4','webm','hls','webp','jpg'
  storage_key   text NOT NULL,
  width         int,
  height        int,
  bitrate_kbps  int,
  size_bytes    bigint,
  UNIQUE (asset_id, label, format)
);

-- ---------------------------------------------------------------------
-- 5. CATALOG  [CONFIRMED: outfits, up to 100 videos, search by name/type]
-- ---------------------------------------------------------------------
CREATE TABLE clothing_types (                    -- admin-managed taxonomy ("shirt","trouser")
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  search_keywords text NOT NULL DEFAULT '',     -- synonyms: 'pants trousers slacks'
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX ix_clothing_types_kw_trgm ON clothing_types USING gin (search_keywords gin_trgm_ops);
CREATE TABLE clothing_type_translations (
  clothing_type_id uuid NOT NULL REFERENCES clothing_types(id) ON DELETE CASCADE,
  language_code    text NOT NULL REFERENCES languages(code),
  name             text NOT NULL,
  PRIMARY KEY (clothing_type_id, language_code)
);
CREATE INDEX ix_cttrans_name_trgm ON clothing_type_translations USING gin (name gin_trgm_ops);

CREATE TABLE sizes (                              -- reference list (S, M, L, XL, ...)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,               -- [CONFIRMED] NOT translated
  clothing_type_id uuid NOT NULL REFERENCES clothing_types(id),
  price_minor      bigint NOT NULL CHECK (price_minor >= 0),
  currency         char(3) NOT NULL DEFAULT 'NGN',   -- [ASSUMPTION] NGN
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive','archived')),
  display_order    int NOT NULL DEFAULT 0,
  search_keywords  text NOT NULL DEFAULT '',          -- extra searchable words (admin-managed)
  video_asset_id   uuid REFERENCES media_assets(id),  -- grid + detail video
  size_chart_id    uuid,                               -- FK added after size_charts (optional per-product override)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Shop listing: active products, stable ordering, 20/page (keyset or offset)
CREATE INDEX ix_products_listing ON products (display_order, id) WHERE status = 'active';
CREATE INDEX ix_products_type ON products (clothing_type_id) WHERE status = 'active';
CREATE INDEX ix_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX ix_products_kw_trgm ON products USING gin (search_keywords gin_trgm_ops);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- [REC] 100-product cap is enforced as configurable app_settings('catalog.max_active_products'), not a DB constant.

CREATE TABLE product_translations (               -- description only; name stays on products
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES languages(code),
  description   text NOT NULL,
  PRIMARY KEY (product_id, language_code)
);

CREATE TABLE product_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id),
  sort_order     int NOT NULL DEFAULT 0
);
CREATE INDEX ix_product_images_product ON product_images (product_id, sort_order);

-- ---------------------------------------------------------------------
-- 6. SIZING / FIND MY SIZE  [CONFIRMED feature] [PENDING: chart, measurements, rules]
-- ---------------------------------------------------------------------
CREATE TABLE measurement_types (                  -- 'chest','waist','hip','height'...
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  unit        text NOT NULL DEFAULT 'cm' CHECK (unit IN ('cm','in')),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);
CREATE TABLE measurement_type_translations (
  measurement_type_id uuid NOT NULL REFERENCES measurement_types(id) ON DELETE CASCADE,
  language_code       text NOT NULL REFERENCES languages(code),
  label               text NOT NULL,
  help_text           text,
  PRIMARY KEY (measurement_type_id, language_code)
);

CREATE TABLE size_charts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  is_sample_data boolean NOT NULL DEFAULT true,   -- production must use is_sample_data = false
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE products ADD CONSTRAINT fk_products_size_chart FOREIGN KEY (size_chart_id) REFERENCES size_charts(id);

CREATE TABLE size_chart_ranges (                  -- one row = size S needs chest between 88 and 96
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  size_chart_id       uuid NOT NULL REFERENCES size_charts(id) ON DELETE CASCADE,
  size_id             uuid NOT NULL REFERENCES sizes(id),
  measurement_type_id uuid NOT NULL REFERENCES measurement_types(id),
  min_value           numeric(6,2) NOT NULL,
  max_value           numeric(6,2) NOT NULL,
  CHECK (max_value >= min_value),
  UNIQUE (size_chart_id, size_id, measurement_type_id)
);
-- Combination logic (e.g. "use the larger size") is a PENDING rule: stored in size_charts via app_settings
-- or a rule_config jsonb column once the client defines it. Not invented here.

-- ---------------------------------------------------------------------
-- 7. INVENTORY  [CONFIRMED: shared stock] [REC: stock per size variant, reservations]
-- ---------------------------------------------------------------------
CREATE TABLE product_variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES products(id),
  size_id           uuid NOT NULL REFERENCES sizes(id),
  sku               text NOT NULL UNIQUE,
  stock_on_hand     int NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
  stock_reserved    int NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  low_stock_threshold int NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  row_version       int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size_id),
  CHECK (stock_reserved <= stock_on_hand)         -- DB-level oversell guard
);
CREATE INDEX ix_variants_product ON product_variants (product_id) WHERE is_active;
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Reserve:  UPDATE product_variants SET stock_reserved = stock_reserved + :q
--           WHERE id = :id AND stock_on_hand - stock_reserved >= :q;   (0 rows => insufficient stock)

CREATE TABLE stock_movements (                    -- append-only ledger
  id            bigserial PRIMARY KEY,
  variant_id    uuid NOT NULL REFERENCES product_variants(id),
  movement_type text NOT NULL CHECK (movement_type IN
                ('initial','restock','adjustment','sale','return','reservation','reservation_release')),
  quantity_delta int NOT NULL,
  reference_type text,                            -- 'order','admin'
  reference_id   text,
  note           text,
  admin_id       uuid REFERENCES admin_users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_stock_movements_variant ON stock_movements (variant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 8. CART  [CONFIRMED] [ASSUMPTION: guest cart merged on login]
-- ---------------------------------------------------------------------
CREATE TABLE carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  guest_token text UNIQUE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','abandoned','merged')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR guest_token IS NOT NULL)
);
CREATE UNIQUE INDEX uq_one_active_cart_per_customer ON carts (customer_id) WHERE status = 'active' AND customer_id IS NOT NULL;
CREATE TRIGGER trg_carts_updated BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES product_variants(id),   -- variant carries product + confirmed size
  quantity    int NOT NULL CHECK (quantity > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
-- Quantity ceiling (max per line) is app_settings('cart.max_quantity_per_item').

-- ---------------------------------------------------------------------
-- 9. ORDERS  [CONFIRMED] historical snapshots, never deleted
-- ---------------------------------------------------------------------
CREATE TABLE order_statuses (                     -- lookup => new statuses are rows, not migrations
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  int NOT NULL,
  is_admin_selectable boolean NOT NULL DEFAULT true,
  is_terminal boolean NOT NULL DEFAULT false
);
INSERT INTO order_statuses (code,label,sort_order,is_admin_selectable,is_terminal) VALUES
  ('pending_payment','Pending payment',10,false,false),   -- [REC] system-managed
  ('being_prepared','Being prepared',20,true,false),       -- [CONFIRMED]
  ('sent_out','Sent out',30,true,false),                   -- [CONFIRMED]
  ('delivered','Delivered',40,true,true),                  -- [CONFIRMED]
  ('cancelled','Cancelled',90,false,true),                 -- [REC] expired/abandoned
  ('payment_failed','Payment failed',15,false,false);      -- [REC]

CREATE SEQUENCE order_number_seq START 100001;

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text NOT NULL UNIQUE DEFAULT ('UI-' || nextval('order_number_seq')),
  customer_id         uuid NOT NULL REFERENCES customers(id),
  source_client       text NOT NULL CHECK (source_client IN ('web','ios','android')),
  idempotency_key     text NOT NULL,
  order_status        text NOT NULL DEFAULT 'pending_payment' REFERENCES order_statuses(code),
  payment_status      text NOT NULL DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','partially_refunded')),
  currency            char(3) NOT NULL,
  subtotal_minor      bigint NOT NULL CHECK (subtotal_minor >= 0),
  delivery_fee_minor  bigint NOT NULL CHECK (delivery_fee_minor >= 0),
  total_minor         bigint NOT NULL CHECK (total_minor = subtotal_minor + delivery_fee_minor),
  -- contact + delivery snapshot (copied; later address edits must not alter history)
  contact_email       citext NOT NULL,
  contact_phone       text NOT NULL,
  recipient_name      text NOT NULL,
  ship_address_line1  text NOT NULL,
  ship_address_line2  text,
  ship_city           text NOT NULL,
  ship_state          text,
  ship_landmark       text,
  delivery_zone_id    uuid REFERENCES delivery_zones(id),
  delivery_zone_name  text NOT NULL,
  language_code       text NOT NULL REFERENCES languages(code),
  reservation_expires_at timestamptz,
  carrier             text,                       -- [PENDING] logistics provider not confirmed
  tracking_reference  text,
  internal_note       text,                       -- admin-only
  cancelled_at        timestamptz,
  cancel_reason       text,
  placed_at           timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key)           -- refresh/double-submit safe
);
CREATE INDEX ix_orders_customer ON orders (customer_id, placed_at DESC);
CREATE INDEX ix_orders_admin_queue ON orders (order_status, placed_at DESC) WHERE payment_status = 'paid';
CREATE INDEX ix_orders_expiry ON orders (reservation_expires_at) WHERE order_status = 'pending_payment';
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id),
  product_id         uuid NOT NULL REFERENCES products(id),         -- RESTRICT: products are archived, never deleted
  variant_id         uuid NOT NULL REFERENCES product_variants(id),
  product_name       text NOT NULL,                                 -- snapshots
  clothing_type_name text NOT NULL,
  size_label         text NOT NULL,
  sku                text NOT NULL,
  unit_price_minor   bigint NOT NULL CHECK (unit_price_minor >= 0),
  quantity           int NOT NULL CHECK (quantity > 0),
  line_total_minor   bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity)
);
CREATE INDEX ix_order_items_order ON order_items (order_id);
CREATE INDEX ix_order_items_variant ON order_items (variant_id);

CREATE TABLE order_status_history (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id),
  from_status  text REFERENCES order_statuses(code),
  to_status    text NOT NULL REFERENCES order_statuses(code),
  changed_by_admin uuid REFERENCES admin_users(id),     -- NULL = system
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_status_history_order ON order_status_history (order_id, created_at);

CREATE TABLE stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  variant_id  uuid NOT NULL REFERENCES product_variants(id),
  quantity    int NOT NULL CHECK (quantity > 0),
  status      text NOT NULL DEFAULT 'held' CHECK (status IN ('held','committed','released')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, variant_id)
);
CREATE INDEX ix_reservations_expiry ON stock_reservations (expires_at) WHERE status = 'held';

-- Generic idempotency store for retry-safe write endpoints (e.g. add-to-cart, address create)
CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text NOT NULL,                 -- 'cart.add', 'address.create'
  idem_key         text NOT NULL,
  subject_id       uuid,
  request_hash     text NOT NULL,
  response_status  int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (scope, idem_key, subject_id)
);
CREATE INDEX ix_idem_expiry ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------
-- 10. PAYMENTS (PAYSTACK)  [CONFIRMED]
-- ---------------------------------------------------------------------
CREATE TABLE payments (                           -- many attempts per order (retry support)
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id),
  provider           text NOT NULL DEFAULT 'paystack',
  reference          text NOT NULL UNIQUE,          -- our generated reference sent to Paystack
  provider_transaction_id text,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL,
  status             text NOT NULL DEFAULT 'initiated'
                     CHECK (status IN ('initiated','pending','success','failed','abandoned','refunded')),
  channel            text,
  gateway_response   text,
  verified_at        timestamptz,                   -- set only after server-side verify call
  paid_at            timestamptz,
  raw_verify_payload jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_payments_order ON payments (order_id);
CREATE UNIQUE INDEX uq_one_success_per_order ON payments (order_id) WHERE status = 'success';  -- no double-charge records
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_webhook_events (             -- idempotent webhook inbox
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL DEFAULT 'paystack',
  provider_event_key text NOT NULL,               -- e.g. event + reference/id hash
  event_type       text NOT NULL,
  reference        text,
  signature_valid  boolean NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  processing_error text,
  UNIQUE (provider, provider_event_key)           -- duplicate callbacks rejected here
);
CREATE INDEX ix_webhook_unprocessed ON payment_webhook_events (received_at) WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------
-- 11. NOTIFICATIONS  [CONFIRMED: order confirmation email] [REC: outbox + retries]
-- ---------------------------------------------------------------------
CREATE TABLE email_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template        text NOT NULL,                  -- 'order_confirmation','password_reset'
  recipient       citext NOT NULL,
  language_code   text NOT NULL REFERENCES languages(code),
  order_id        uuid REFERENCES orders(id),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_due ON email_outbox (next_attempt_at) WHERE status = 'queued';
CREATE UNIQUE INDEX uq_outbox_order_confirmation ON email_outbox (order_id, template) WHERE template = 'order_confirmation';

-- ---------------------------------------------------------------------
-- 12. CONTENT & QR PAGES  [CONFIRMED: 14 QR pages, stable URLs, admin-editable]
-- ---------------------------------------------------------------------
CREATE TABLE content_blocks (                     -- hero text, footer, policies, etc.
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_key     text NOT NULL UNIQUE,             -- 'home.hero', 'policy.returns'
  media_asset_id uuid REFERENCES media_assets(id),-- hero video replaceable from admin
  is_published  boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES admin_users(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_block_translations (
  content_block_id uuid NOT NULL REFERENCES content_blocks(id) ON DELETE CASCADE,
  language_code    text NOT NULL REFERENCES languages(code),
  title            text,
  body             text,                          -- sanitized rich text / markdown
  cta_label        text,
  PRIMARY KEY (content_block_id, language_code)
);

CREATE TABLE qr_pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_number  int NOT NULL UNIQUE CHECK (slot_number BETWEEN 1 AND 14),
  slug         text NOT NULL UNIQUE,              -- the printed URL path: /q/{slug}  -- IMMUTABLE
  is_published boolean NOT NULL DEFAULT true,
  media_asset_id uuid REFERENCES media_assets(id),
  updated_by   uuid REFERENCES admin_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE qr_page_translations (
  qr_page_id    uuid NOT NULL REFERENCES qr_pages(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES languages(code),
  title         text NOT NULL,
  body          text NOT NULL,
  PRIMARY KEY (qr_page_id, language_code)
);
CREATE OR REPLACE FUNCTION forbid_qr_slug_change() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'qr_pages.slug is immutable (printed QR codes depend on it)';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_qr_slug_immutable BEFORE UPDATE ON qr_pages FOR EACH ROW EXECUTE FUNCTION forbid_qr_slug_change();
CREATE TRIGGER trg_qr_updated BEFORE UPDATE ON qr_pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Optional scan analytics (placement is PENDING): add qr_scan_events later without touching this table.

-- ---------------------------------------------------------------------
-- 13. SETTINGS  [PENDING items live here as NULL until supplied]
-- ---------------------------------------------------------------------
CREATE TABLE app_settings (
  setting_key text PRIMARY KEY,
  value       jsonb,                              -- NULL = not yet provided
  description text,
  updated_by  uuid REFERENCES admin_users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (setting_key, value, description) VALUES
  ('catalog.max_active_products', '100',  '[CONFIRMED] up to 100 product videos'),
  ('catalog.page_size',           '20',   '[CONFIRMED] 20 outfits per page'),
  ('checkout.reservation_minutes','15',   '[REC] stock hold during payment'),
  ('cart.max_quantity_per_item',  '10',   '[ASSUMPTION] confirm with client'),
  ('support.email',               NULL,   '[PENDING]'),
  ('support.phone',               NULL,   '[PENDING]'),
  ('support.whatsapp',            NULL,   '[PENDING]'),
  ('social.links',                NULL,   '[PENDING]'),
  ('policy.returns_content_key',  NULL,   '[PENDING] return & exchange policy'),
  ('brand.palette',               NULL,   '[PENDING] colour palette'),
  ('logistics.provider',          NULL,   '[PENDING] Jumia Logistics mentioned, unconfirmed');

COMMIT;
