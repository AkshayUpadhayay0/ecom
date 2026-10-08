-- =====================================================================
-- Migration 0002 - Requirements v2.0 (client "Source of Truth", 7 Oct 2026)
-- Applies on top of schema_v2.sql. Applied by `pnpm db:migrate` inside a transaction and tracked in
-- schema_migrations by the runner (no BEGIN/COMMIT or bookkeeping here).
-- Sample data for it: db/seeds/seed_0002_blueprint_qr.sql
--
-- A. Blueprint / Find My Size  -> height + weight + fit preference, versioned rules, decision history
-- B. Return / Exchange         -> requests linked to the exact order item + Blueprint decision
-- C. Secret QR pages           -> 8 permanent QR codes, protected access (Option 2), no admin editing
--
-- Labels: [CONFIRMED] from the v2.0 document | [TEAM DESIGN] our design, to confirm | [ASSUMPTION] needs client answer
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cart_items) OR EXISTS (SELECT 1 FROM order_items) THEN
    RAISE EXCEPTION 'cart_items/order_items already contain rows. Blueprint decisions must be backfilled first; migration aborted.';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed to forbid overlapping Blueprint ranges

-- =====================================================================
-- A. BLUEPRINT / FIND MY SIZE
-- =====================================================================

-- Old chest/waist/hip structure is replaced [CONFIRMED]. Only sample data existed in these tables.
ALTER TABLE products DROP COLUMN size_chart_id;
DROP TABLE size_chart_ranges;
DROP TABLE size_charts;
DROP TABLE measurement_type_translations;
DROP TABLE measurement_types;

-- Fit Preference options are exactly Tailored, Standard, Oversized [CONFIRMED]
CREATE TABLE fit_preferences (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);
INSERT INTO fit_preferences (code, label, sort_order) VALUES
  ('tailored','Tailored',1), ('standard','Standard',2), ('oversized','Oversized',3);

-- Garment cut: lets the tailor give different mappings per cut. [PENDING tailor] No rows seeded.
CREATE TABLE garment_cuts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_garment_cuts_updated BEFORE UPDATE ON garment_cuts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE products ADD COLUMN garment_cut_id uuid REFERENCES garment_cuts(id);
CREATE INDEX ix_products_garment_cut ON products (garment_cut_id);

-- Versioned rule sets. garment_cut_id NULL = default rule set for products without a specific cut.
-- Resolution (service layer): active set for the product's cut, else the active default set.
CREATE TABLE blueprint_rule_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garment_cut_id  uuid REFERENCES garment_cuts(id),
  version         int NOT NULL CHECK (version > 0),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  is_sample_data  boolean NOT NULL DEFAULT true,       -- production must use false (real tailor data)
  effective_from  timestamptz,
  retired_at      timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rule_set_scope_version UNIQUE NULLS NOT DISTINCT (garment_cut_id, version)
);
CREATE UNIQUE INDEX uq_rule_set_one_active_per_scope
  ON blueprint_rule_sets ((COALESCE(garment_cut_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'active';
CREATE TRIGGER trg_rule_sets_updated BEFORE UPDATE ON blueprint_rule_sets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One rule = for this fit preference, height in [min,max) and weight in [min,max) -> this size.
-- Half-open ranges: no gaps/overlaps at boundaries. No matching rule => no recommendation (never guess).
CREATE TABLE blueprint_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id    uuid NOT NULL REFERENCES blueprint_rule_sets(id),
  fit_preference text NOT NULL REFERENCES fit_preferences(code),
  height_min_cm  numeric(5,1) NOT NULL CHECK (height_min_cm > 0),
  height_max_cm  numeric(5,1) NOT NULL,
  weight_min_kg  numeric(5,1) NOT NULL CHECK (weight_min_kg > 0),
  weight_max_kg  numeric(5,1) NOT NULL,
  size_id        uuid NOT NULL REFERENCES sizes(id),
  CHECK (height_max_cm > height_min_cm),
  CHECK (weight_max_kg > weight_min_kg),
  CONSTRAINT ex_blueprint_rules_no_overlap EXCLUDE USING gist (
    rule_set_id    WITH =,
    fit_preference WITH =,
    numrange(height_min_cm, height_max_cm, '[)') WITH &&,
    numrange(weight_min_kg, weight_max_kg, '[)') WITH &&
  )
);
CREATE INDEX ix_blueprint_rules_lookup ON blueprint_rules (rule_set_id, fit_preference);

-- Rule sets: only drafts may be deleted; activation needs rules; published version/scope are immutable.
CREATE FUNCTION guard_blueprint_rule_sets() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft rule sets can be deleted (historical accuracy)';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'active' THEN
      IF NOT EXISTS (SELECT 1 FROM blueprint_rules WHERE rule_set_id = NEW.id) THEN
        RAISE EXCEPTION 'Cannot activate a rule set that has no rules';
      END IF;
      NEW.effective_from := COALESCE(NEW.effective_from, now());
    ELSIF NEW.status = 'retired' THEN
      RAISE EXCEPTION 'A draft rule set cannot be retired; delete it instead';
    END IF;
  ELSIF OLD.status = 'active' THEN
    IF NEW.status NOT IN ('active','retired') THEN
      RAISE EXCEPTION 'An active rule set can only be retired';
    END IF;
    IF NEW.status = 'retired' THEN NEW.retired_at := COALESCE(NEW.retired_at, now()); END IF;
  ELSE
    IF NEW.status <> 'retired' THEN RAISE EXCEPTION 'A retired rule set cannot be reopened'; END IF;
  END IF;

  IF OLD.status <> 'draft' AND (NEW.version <> OLD.version OR NEW.garment_cut_id IS DISTINCT FROM OLD.garment_cut_id) THEN
    RAISE EXCEPTION 'Version and scope of a published rule set are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rule_sets_guard BEFORE UPDATE OR DELETE ON blueprint_rule_sets
  FOR EACH ROW EXECUTE FUNCTION guard_blueprint_rule_sets();

-- Rules can only change while their rule set is a draft.
CREATE FUNCTION guard_blueprint_rules() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT status INTO v_status FROM blueprint_rule_sets WHERE id = OLD.rule_set_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Rules of a published rule set are immutable (create a new version instead)';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT status INTO v_status FROM blueprint_rule_sets WHERE id = NEW.rule_set_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Rules of a published rule set are immutable (create a new version instead)';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON blueprint_rules
  FOR EACH ROW EXECUTE FUNCTION guard_blueprint_rules();

-- The fitting decision: append-only record of what Blueprint said and what the customer chose. [CONFIRMED]
--   MATCHED  + same size     => RECOMMENDED_LOCKED
--   MATCHED  + different size => OVERRIDE
--   NO_MATCH / SKIPPED       => MANUAL      ([ASSUMPTION] MANUAL = no recommendation was shown)
-- Guests can create decisions (guest cart); on login the decision is "claimed" by setting customer_id once.
CREATE TABLE blueprint_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            uuid REFERENCES customers(id),
  guest_token            text,
  product_id             uuid NOT NULL REFERENCES products(id),
  garment_cut_id         uuid REFERENCES garment_cuts(id),         -- snapshot of the product's cut
  rule_set_id            uuid REFERENCES blueprint_rule_sets(id),
  rule_version           int,                                      -- snapshot (filled by trigger)
  height_cm              numeric(5,1) CHECK (height_cm > 0),
  weight_kg              numeric(5,1) CHECK (weight_kg > 0),
  fit_preference         text REFERENCES fit_preferences(code),
  recommendation_outcome text NOT NULL CHECK (recommendation_outcome IN ('MATCHED','NO_MATCH','SKIPPED')),
  recommended_size_id    uuid REFERENCES sizes(id),
  selected_size_id       uuid NOT NULL REFERENCES sizes(id),
  selection_mode         text NOT NULL CHECK (selection_mode IN ('RECOMMENDED_LOCKED','OVERRIDE','MANUAL')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id IS NOT NULL OR guest_token IS NOT NULL),
  CONSTRAINT ck_decision_consistency CHECK (
    ( recommendation_outcome = 'MATCHED'
      AND rule_set_id IS NOT NULL AND height_cm IS NOT NULL AND weight_kg IS NOT NULL
      AND fit_preference IS NOT NULL AND recommended_size_id IS NOT NULL
      AND ( (selection_mode = 'RECOMMENDED_LOCKED' AND selected_size_id =  recommended_size_id)
         OR (selection_mode = 'OVERRIDE'           AND selected_size_id <> recommended_size_id) ) )
    OR ( recommendation_outcome = 'NO_MATCH'
      AND height_cm IS NOT NULL AND weight_kg IS NOT NULL AND fit_preference IS NOT NULL
      AND recommended_size_id IS NULL AND selection_mode = 'MANUAL' )
    OR ( recommendation_outcome = 'SKIPPED'
      AND height_cm IS NULL AND weight_kg IS NULL AND fit_preference IS NULL
      AND rule_set_id IS NULL AND recommended_size_id IS NULL AND selection_mode = 'MANUAL' )
  )
);
CREATE INDEX ix_decisions_customer ON blueprint_decisions (customer_id, created_at DESC);
CREATE INDEX ix_decisions_guest    ON blueprint_decisions (guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX ix_decisions_product  ON blueprint_decisions (product_id);

CREATE FUNCTION fill_blueprint_decision() RETURNS trigger AS $$
DECLARE v_status text; v_version int;
BEGIN
  IF NEW.rule_set_id IS NOT NULL THEN
    SELECT status, version INTO v_status, v_version FROM blueprint_rule_sets WHERE id = NEW.rule_set_id;
    IF v_status = 'draft' THEN RAISE EXCEPTION 'A decision cannot use a draft rule set'; END IF;
    NEW.rule_version := v_version;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_decisions_fill BEFORE INSERT ON blueprint_decisions FOR EACH ROW EXECUTE FUNCTION fill_blueprint_decision();

CREATE FUNCTION guard_blueprint_decisions() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'blueprint_decisions are append-only'; END IF;
  IF OLD.customer_id IS NULL AND NEW.customer_id IS NOT NULL
     AND (to_jsonb(NEW) - 'customer_id') = (to_jsonb(OLD) - 'customer_id') THEN
    RETURN NEW;   -- claiming a guest decision on login is the only allowed change
  END IF;
  RAISE EXCEPTION 'blueprint_decisions are immutable';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_decisions_guard BEFORE UPDATE OR DELETE ON blueprint_decisions
  FOR EACH ROW EXECUTE FUNCTION guard_blueprint_decisions();

-- Cart and order lines must carry the decision, and it must match the variant (product + size).
ALTER TABLE cart_items  ADD COLUMN blueprint_decision_id uuid NOT NULL REFERENCES blueprint_decisions(id);
ALTER TABLE order_items ADD COLUMN blueprint_decision_id uuid NOT NULL REFERENCES blueprint_decisions(id);
CREATE INDEX ix_cart_items_decision  ON cart_items  (blueprint_decision_id);
CREATE INDEX ix_order_items_decision ON order_items (blueprint_decision_id);

CREATE FUNCTION check_line_matches_decision() RETURNS trigger AS $$
DECLARE v_product uuid; v_size uuid; d record; o_customer uuid;
BEGIN
  SELECT product_id, size_id INTO v_product, v_size FROM product_variants WHERE id = NEW.variant_id;
  SELECT product_id, selected_size_id, customer_id INTO d FROM blueprint_decisions WHERE id = NEW.blueprint_decision_id;
  IF v_product IS DISTINCT FROM d.product_id OR v_size IS DISTINCT FROM d.selected_size_id THEN
    RAISE EXCEPTION 'Blueprint decision does not match the selected product/size';
  END IF;
  IF TG_TABLE_NAME = 'order_items' THEN
    SELECT customer_id INTO o_customer FROM orders WHERE id = NEW.order_id;
    IF d.customer_id IS DISTINCT FROM o_customer THEN
      RAISE EXCEPTION 'Blueprint decision belongs to a different customer than the order';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cart_items_decision  BEFORE INSERT OR UPDATE OF variant_id, blueprint_decision_id ON cart_items
  FOR EACH ROW EXECUTE FUNCTION check_line_matches_decision();
CREATE TRIGGER trg_order_items_decision BEFORE INSERT OR UPDATE OF variant_id, blueprint_decision_id ON order_items
  FOR EACH ROW EXECUTE FUNCTION check_line_matches_decision();

-- =====================================================================
-- B. RETURN / EXCHANGE   [CONFIRMED structure; operational policy = TEAM DESIGN, kept configurable]
-- =====================================================================
CREATE TABLE return_reasons (
  code                 text PRIMARY KEY,
  label                text NOT NULL,
  evidence_requirement text NOT NULL CHECK (evidence_requirement IN ('required','optional','none')),
  sort_order           int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true
);
INSERT INTO return_reasons (code, label, evidence_requirement, sort_order) VALUES
  ('does_not_fit',   'Does not fit',                    'optional', 1),   -- [CONFIRMED design]
  ('wrong_item',     'Wrong item delivered',            'required', 2),
  ('damaged_faulty', 'Item arrived damaged/faulty',     'required', 3),
  ('changed_mind',   'Changed my mind',                 'none',     4),
  ('other',          'Other',                           'optional', 5);   -- [ASSUMPTION] optional

CREATE TABLE return_statuses (                 -- [TEAM DESIGN] proposed workflow; lookup so it can change without migrations
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  int NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false
);
INSERT INTO return_statuses (code,label,sort_order,is_terminal) VALUES
  ('submitted','Submitted',10,false), ('under_review','Under review',20,false),
  ('approved','Approved',30,false),   ('awaiting_return','Awaiting item return',40,false),
  ('received','Item received',50,false), ('completed','Completed',90,true),
  ('rejected','Rejected',91,true),    ('cancelled','Cancelled by customer',92,true);

-- Versioned operational policy. NULL = not decided yet [TEAM DESIGN / PENDING]; nothing is hard-coded.
CREATE TABLE return_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                 int NOT NULL UNIQUE CHECK (version > 0),
  name                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  request_window_days     int CHECK (request_window_days >= 0),
  require_original_tags   boolean,
  require_unworn_unwashed boolean,
  extra_rules             jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                   text,
  effective_from          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_return_policy_one_active ON return_policies ((true)) WHERE status = 'active';
CREATE TRIGGER trg_return_policies_updated BEFORE UPDATE ON return_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE return_number_seq START 1001;

CREATE TABLE return_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number          text NOT NULL UNIQUE DEFAULT ('RT-' || nextval('return_number_seq')),
  order_id                uuid NOT NULL REFERENCES orders(id),
  order_item_id           uuid NOT NULL REFERENCES order_items(id),     -- the exact purchased item
  customer_id             uuid NOT NULL REFERENCES customers(id),
  request_type            text NOT NULL CHECK (request_type IN ('RETURN','EXCHANGE')),
  reason_code             text NOT NULL REFERENCES return_reasons(code),
  customer_explanation    text CHECK (char_length(customer_explanation) <= 2000),
  quantity                int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  exchange_size_id        uuid REFERENCES sizes(id),                    -- [ASSUMPTION] exchange = same product, other size
  blueprint_decision_id   uuid NOT NULL REFERENCES blueprint_decisions(id), -- filled from the order item by trigger
  policy_id               uuid REFERENCES return_policies(id),          -- policy version applied at request time
  status                  text NOT NULL DEFAULT 'submitted' REFERENCES return_statuses(code),
  fault_classification    text NOT NULL DEFAULT 'REVIEW_REQUIRED'
                          CHECK (fault_classification IN ('CUSTOMER_FAULT','BRAND_FAULT','REVIEW_REQUIRED')),
  fault_classified_by     text NOT NULL DEFAULT 'SYSTEM' CHECK (fault_classified_by IN ('SYSTEM','ADMIN')),
  fault_basis             text,                                         -- e.g. 'blueprint_override', 'change_of_mind'
  fault_classified_at     timestamptz,
  reverse_logistics_payer text NOT NULL DEFAULT 'UNDECIDED' CHECK (reverse_logistics_payer IN ('CUSTOMER','BRAND','UNDECIDED')),
  admin_decision          text NOT NULL DEFAULT 'PENDING' CHECK (admin_decision IN ('PENDING','APPROVED','REJECTED')),
  admin_notes             text,
  reviewed_by             uuid REFERENCES admin_users(id),
  reviewed_at             timestamptz,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (request_type = 'EXCHANGE' OR exchange_size_id IS NULL)
);
CREATE INDEX ix_returns_customer ON return_requests (customer_id, submitted_at DESC);
CREATE INDEX ix_returns_order    ON return_requests (order_id);
CREATE INDEX ix_returns_queue    ON return_requests (status, submitted_at) WHERE status NOT IN ('completed','rejected','cancelled');
-- one open request per purchased item
CREATE UNIQUE INDEX uq_returns_one_open_per_item ON return_requests (order_item_id)
  WHERE status NOT IN ('completed','rejected','cancelled');
CREATE TRIGGER trg_return_requests_updated BEFORE UPDATE ON return_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION guard_return_request_insert() RETURNS trigger AS $$
DECLARE i record; o_customer uuid;
BEGIN
  SELECT order_id, blueprint_decision_id, quantity INTO i FROM order_items WHERE id = NEW.order_item_id;
  IF NOT FOUND OR i.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'The order item does not belong to this order';
  END IF;
  SELECT customer_id INTO o_customer FROM orders WHERE id = NEW.order_id;
  IF o_customer <> NEW.customer_id THEN
    RAISE EXCEPTION 'The order belongs to a different customer';
  END IF;
  IF NEW.quantity > i.quantity THEN
    RAISE EXCEPTION 'Return quantity exceeds the purchased quantity';
  END IF;
  NEW.blueprint_decision_id := i.blueprint_decision_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_return_requests_guard BEFORE INSERT ON return_requests
  FOR EACH ROW EXECUTE FUNCTION guard_return_request_insert();

CREATE TABLE return_request_media (               -- photos live in object storage; this only links media records
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id uuid NOT NULL REFERENCES return_requests(id),
  media_asset_id    uuid NOT NULL REFERENCES media_assets(id),
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_request_id, media_asset_id)
);

CREATE TABLE return_request_events (
  id                bigserial PRIMARY KEY,
  return_request_id uuid NOT NULL REFERENCES return_requests(id),
  event_type        text NOT NULL,                  -- 'submitted','status_changed','fault_reclassified','note_added'
  from_status       text REFERENCES return_statuses(code),
  to_status         text REFERENCES return_statuses(code),
  actor_type        text NOT NULL CHECK (actor_type IN ('CUSTOMER','ADMIN','SYSTEM')),
  actor_id          uuid,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_return_events_request ON return_request_events (return_request_id, created_at);

-- =====================================================================
-- C. SECRET QR PAGES   8 permanent codes, Option 2 protected access [CONFIRMED]
-- Flow: QR holds a permanent secret URL -> server checks the token hash -> issues a short-lived
-- browser-bound access grant -> the secret page only opens with a valid grant.
-- Content is NOT editable from admin: developers update qr_page_translations via scripts.
-- =====================================================================
DELETE FROM qr_pages WHERE slot_number > 8;      -- v2 had 14 placeholder slots; nothing was ever printed
ALTER TABLE qr_pages DROP CONSTRAINT IF EXISTS qr_pages_slot_number_check;
ALTER TABLE qr_pages ADD CONSTRAINT ck_qr_slot_positive CHECK (slot_number > 0);   -- no hard-coded upper limit
ALTER TABLE qr_pages DROP COLUMN updated_by;                                        -- no admin editing
ALTER TABLE qr_pages ADD COLUMN access_token_hash   text,        -- SHA-256 of the secret in the QR URL (NULL until provisioned)
                     ADD COLUMN token_provisioned_at timestamptz,
                     ADD COLUMN token_locked_at     timestamptz, -- set at print handover: token can never change afterwards
                     ADD CONSTRAINT ck_qr_locked_needs_token CHECK (token_locked_at IS NULL OR access_token_hash IS NOT NULL);
CREATE UNIQUE INDEX uq_qr_pages_token_hash ON qr_pages (access_token_hash) WHERE access_token_hash IS NOT NULL;

DROP TRIGGER trg_qr_slug_immutable ON qr_pages;
DROP FUNCTION forbid_qr_slug_change();
CREATE FUNCTION guard_qr_pages() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'qr_pages.slug is immutable (stable internal page location)';
  END IF;
  IF OLD.token_locked_at IS NOT NULL
     AND ( NEW.access_token_hash IS DISTINCT FROM OLD.access_token_hash
        OR NEW.token_locked_at   IS DISTINCT FROM OLD.token_locked_at ) THEN
    RAISE EXCEPTION 'The QR token is locked (printed codes must keep working)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_qr_pages_guard BEFORE UPDATE ON qr_pages FOR EACH ROW EXECUTE FUNCTION guard_qr_pages();

CREATE TABLE qr_access_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_page_id       uuid NOT NULL REFERENCES qr_pages(id),
  grant_token_hash text NOT NULL UNIQUE,            -- hash of the random value kept in the visitor's HttpOnly cookie
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
CREATE INDEX ix_qr_grants_page   ON qr_access_grants (qr_page_id, created_at DESC);
CREATE INDEX ix_qr_grants_expiry ON qr_access_grants (expires_at);

CREATE TABLE qr_access_events (                   -- security/audit log (also useful if QR abuse is suspected)
  id          bigserial PRIMARY KEY,
  qr_page_id  uuid REFERENCES qr_pages(id),
  outcome     text NOT NULL CHECK (outcome IN
              ('GRANTED','INVALID_TOKEN','PAGE_UNPUBLISHED','GRANT_VALID','GRANT_INVALID','RATE_LIMITED')),
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_qr_events_time ON qr_access_events (created_at DESC);

-- =====================================================================
-- D. SETTINGS / NOTES
-- =====================================================================
INSERT INTO app_settings (setting_key, value, description) VALUES
  ('qr.grant_ttl_minutes', '1440', '[TEAM DESIGN / ASSUMPTION] how long a scanned QR keeps a browser inside its secret page')
ON CONFLICT (setting_key) DO NOTHING;

COMMENT ON TABLE ui_translations IS 'DEPRECATION CANDIDATE: v2.0 says approved Pidgin copy is added by the team, so UI text will likely live in frontend language files. Kept until the frontend framework is chosen.';
COMMENT ON TABLE blueprint_decisions IS 'Append-only. Never recalculated; old orders keep the rule version used at purchase time.';
COMMENT ON TABLE qr_pages IS 'Content is developer-managed (no admin editing). access_token_hash is the permanent QR secret; lock it at print handover.';
