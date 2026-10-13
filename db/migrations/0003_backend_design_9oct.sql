-- =====================================================================
-- Migration 0003 - Backend System Design (9 Oct 2026)
-- Applies on top of 0002_requirements_v2. Applied by `pnpm db:migrate` inside a transaction and
-- tracked in schema_migrations by the runner (no BEGIN/COMMIT or bookkeeping here).
-- Seed for it: db/seeds/seed_0003_charts.sql
--
-- A. Blueprint v2   : body-measurement size charts (versioned) replace height/weight rules;
--                     "largest required size" decisions; Quick Fit + Body Scan feed one engine
-- B. Fault-Line     : responsibility vs workflow status, fault causes, 12-step return workflow,
--                     inspection before restock, exchange replacement reservations, private evidence
-- C. Hidden pages   : exact-serial validation (GENERAL = one page, EXCLUSIVE = all) + secure grants
-- D. Catalogue      : no hard product cap; media can be private / retired
--
-- Labels: [DOC] stated in the 9 Oct design document | [TEAM DESIGN] our design, to confirm
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('public.blueprint_decisions') IS NULL THEN
    RAISE EXCEPTION 'Apply 0002_requirements_v2.sql first (blueprint_decisions not found).';
  END IF;
  IF EXISTS (SELECT 1 FROM blueprint_decisions) THEN
    RAISE EXCEPTION 'blueprint_decisions already has rows (height/weight era). They cannot be converted to measurement-based decisions; clear test data first.';
  END IF;
  IF EXISTS (SELECT 1 FROM qr_access_grants) THEN
    RAISE EXCEPTION 'qr_access_grants has rows; the QR-only access model is replaced. Clear test data first.';
  END IF;
  IF EXISTS (SELECT 1 FROM qr_pages WHERE access_token_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'QR token hashes were already provisioned. Hashed tokens cannot be converted to printable route tokens; review before continuing.';
  END IF;
END $$;

-- =====================================================================
-- A. BLUEPRINT v2
-- =====================================================================

-- A1. Remove the height/weight design from 0001 [DOC: weight is not a sizing input]
DROP TRIGGER IF EXISTS trg_decisions_fill ON blueprint_decisions;
DROP FUNCTION IF EXISTS fill_blueprint_decision();
ALTER TABLE blueprint_decisions DROP CONSTRAINT ck_decision_consistency;
ALTER TABLE blueprint_decisions DROP CONSTRAINT IF EXISTS blueprint_decisions_selection_mode_check;
ALTER TABLE blueprint_decisions
  DROP COLUMN guest_token,  DROP COLUMN garment_cut_id, DROP COLUMN rule_set_id, DROP COLUMN rule_version,
  DROP COLUMN height_cm,    DROP COLUMN weight_kg,      DROP COLUMN recommendation_outcome;
DROP TABLE blueprint_rules;
DROP TABLE blueprint_rule_sets;
DROP FUNCTION guard_blueprint_rules();
DROP FUNCTION guard_blueprint_rule_sets();
ALTER TABLE products DROP COLUMN garment_cut_id;      -- superseded by measurement profiles
DROP TABLE garment_cuts;

-- A2. Measurement vocabulary. All chart and customer values are stored in INCHES (canonical).
--     [ASSUMPTION] the API converts cm input to inches before storing.
CREATE TABLE measurement_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  help_text   text,                         -- English instruction; Pidgin copy is static frontend copy
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

-- A3. Chart groups (female, male top, male trouser, agbada body, fila/cap) and the measurements each uses
CREATE TABLE size_chart_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  audience    text NOT NULL DEFAULT 'ANY' CHECK (audience IN ('FEMALE','MALE','ANY')),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE TABLE size_chart_group_measurements (
  group_id            uuid NOT NULL REFERENCES size_chart_groups(id),
  measurement_type_id uuid NOT NULL REFERENCES measurement_types(id),
  sort_order          int NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, measurement_type_id)
);

-- A4. Versioned charts. Active/retired charts are immutable so history never changes. [DOC]
CREATE TABLE size_charts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES size_chart_groups(id),
  version        int  NOT NULL CHECK (version > 0),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  -- Boundary logic is versioned with the chart [DOC]. Only one rule exists today:
  -- a measurement maps to the smallest size whose upper bound covers it.
  boundary_rule  text NOT NULL DEFAULT 'SMALLEST_COVERING_SIZE' CHECK (boundary_rule IN ('SMALLEST_COVERING_SIZE')),
  source_note    text,
  is_sample_data boolean NOT NULL DEFAULT false,
  effective_from timestamptz,
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, version),
  UNIQUE (id, group_id)
);
CREATE UNIQUE INDEX uq_size_chart_one_active_per_group ON size_charts (group_id) WHERE status = 'active';
CREATE TRIGGER trg_size_charts_updated BEFORE UPDATE ON size_charts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row = for this chart, size S needs measurement M between min and max inches.
-- Ranges of neighbouring sizes MAY overlap in the client's real chart (e.g. sleeve 25 appears in M and L),
-- so no overlap constraint: the boundary rule resolves it.
CREATE TABLE size_chart_rows (
  chart_id            uuid NOT NULL,
  group_id            uuid NOT NULL,
  size_id             uuid NOT NULL REFERENCES sizes(id),
  measurement_type_id uuid NOT NULL REFERENCES measurement_types(id),
  min_inches          numeric(5,1) NOT NULL CHECK (min_inches > 0),
  max_inches          numeric(5,1) NOT NULL,
  PRIMARY KEY (chart_id, size_id, measurement_type_id),
  CHECK (max_inches >= min_inches),
  FOREIGN KEY (chart_id, group_id) REFERENCES size_charts (id, group_id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, measurement_type_id) REFERENCES size_chart_group_measurements (group_id, measurement_type_id)
);
CREATE INDEX ix_size_chart_rows_lookup ON size_chart_rows (chart_id, measurement_type_id, max_inches);

CREATE FUNCTION guard_size_charts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Only draft size charts can be deleted (historical accuracy)'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'active' THEN
      IF NOT EXISTS (SELECT 1 FROM size_chart_rows WHERE chart_id = NEW.id) THEN
        RAISE EXCEPTION 'Cannot activate a size chart that has no rows';
      END IF;
      IF (SELECT count(*) FROM size_chart_rows WHERE chart_id = NEW.id)
         <> (SELECT count(DISTINCT size_id) FROM size_chart_rows WHERE chart_id = NEW.id)
            * (SELECT count(*) FROM size_chart_group_measurements WHERE group_id = NEW.group_id) THEN
        RAISE EXCEPTION 'Size chart is incomplete: every size needs a range for every measurement of its group';
      END IF;
      NEW.effective_from := COALESCE(NEW.effective_from, now());
    ELSIF NEW.status = 'retired' THEN
      RAISE EXCEPTION 'A draft size chart cannot be retired; delete it instead';
    END IF;
  ELSIF OLD.status = 'active' THEN
    IF NEW.status NOT IN ('active','retired') THEN RAISE EXCEPTION 'An active size chart can only be retired'; END IF;
    IF NEW.status = 'retired' THEN NEW.retired_at := COALESCE(NEW.retired_at, now()); END IF;
  ELSE
    IF NEW.status <> 'retired' THEN RAISE EXCEPTION 'A retired size chart cannot be reopened'; END IF;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.version <> OLD.version OR NEW.group_id <> OLD.group_id
                                OR NEW.boundary_rule <> OLD.boundary_rule) THEN
    RAISE EXCEPTION 'Version, group and boundary rule of a published chart are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_size_charts_guard BEFORE UPDATE OR DELETE ON size_charts
  FOR EACH ROW EXECUTE FUNCTION guard_size_charts();

CREATE FUNCTION guard_size_chart_rows() RETURNS trigger AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT status INTO v_status FROM size_charts WHERE id = OLD.chart_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'Rows of a published size chart are immutable (create a new version instead)';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT status INTO v_status FROM size_charts WHERE id = NEW.chart_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Rows of a published size chart are immutable (create a new version instead)';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_size_chart_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON size_chart_rows
  FOR EACH ROW EXECUTE FUNCTION guard_size_chart_rows();

-- A5. Measurement profiles = "product construction/type" [DOC]: which chart measurements a product needs.
--     A two-piece set uses ONE profile spanning two chart groups (top + trouser) -> one overall size.
CREATE TABLE measurement_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_measurement_profiles_updated BEFORE UPDATE ON measurement_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE measurement_profile_items (
  profile_id          uuid NOT NULL REFERENCES measurement_profiles(id) ON DELETE CASCADE,
  chart_group_id      uuid NOT NULL,
  measurement_type_id uuid NOT NULL,
  sort_order          int NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, chart_group_id, measurement_type_id),
  FOREIGN KEY (chart_group_id, measurement_type_id) REFERENCES size_chart_group_measurements (group_id, measurement_type_id)
);
-- NULL profile = product does not use Blueprint (no fitting decision required).
ALTER TABLE products ADD COLUMN measurement_profile_id uuid REFERENCES measurement_profiles(id);
CREATE INDEX ix_products_profile ON products (measurement_profile_id);

-- A6. Body Scan sessions: provider-neutral. Provider/capture rules are NOT invented here. [DOC]
CREATE TABLE body_scan_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES customers(id),
  product_id          uuid NOT NULL REFERENCES products(id),
  status              text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','IN_PROGRESS','COMPLETED','FAILED')),
  provider            text,                         -- NULL until a provider is chosen
  external_ref        text,
  result_measurements jsonb,                        -- minimal result only: { "bust": 36.5, ... } inches. NO images stored.
  result_purged_at    timestamptz,                  -- result can be scrubbed once copied into the fitting record
  failure_reason      text,
  expires_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'COMPLETED' OR result_measurements IS NOT NULL OR result_purged_at IS NOT NULL)
);
CREATE UNIQUE INDEX uq_body_scan_external ON body_scan_sessions (provider, external_ref) WHERE provider IS NOT NULL AND external_ref IS NOT NULL;
CREATE INDEX ix_body_scan_customer ON body_scan_sessions (customer_id, created_at DESC);
CREATE TRIGGER trg_body_scan_updated BEFORE UPDATE ON body_scan_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE FUNCTION guard_body_scan_sessions() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('COMPLETED','FAILED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'A finished body-scan session cannot change status';
  END IF;
  IF NEW.customer_id <> OLD.customer_id OR NEW.product_id <> OLD.product_id THEN
    RAISE EXCEPTION 'A body-scan session cannot be reassigned';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_body_scan_guard BEFORE UPDATE ON body_scan_sessions FOR EACH ROW EXECUTE FUNCTION guard_body_scan_sessions();

-- A7. The fitting record: ONE row per lock/override. Append-only. [DOC]
--     LOCKED_RECOMMENDATION: selected = recommended.  OVERRIDE: selected <> recommended.
--     Fit preference is STORED but never changes the chart-derived size. [DOC]
ALTER TABLE blueprint_decisions
  ALTER COLUMN customer_id SET NOT NULL,
  ALTER COLUMN fit_preference SET NOT NULL,
  ALTER COLUMN recommended_size_id SET NOT NULL,
  ADD COLUMN measurement_profile_id uuid NOT NULL REFERENCES measurement_profiles(id),
  ADD COLUMN measurement_method text NOT NULL CHECK (measurement_method IN ('MANUAL_MEASUREMENTS','BODY_SCAN')),
  ADD COLUMN body_scan_session_id uuid REFERENCES body_scan_sessions(id),
  ADD COLUMN chart_snapshot jsonb NOT NULL;           -- e.g. {"charts":[{"group":"male_top","version":1}],"boundaryRule":"SMALLEST_COVERING_SIZE"}
ALTER TABLE blueprint_decisions
  ADD CONSTRAINT ck_decision_mode CHECK (
    (selection_mode = 'LOCKED_RECOMMENDATION' AND selected_size_id =  recommended_size_id) OR
    (selection_mode = 'OVERRIDE'              AND selected_size_id <> recommended_size_id)),
  ADD CONSTRAINT ck_decision_method_session CHECK (
    (measurement_method = 'BODY_SCAN'           AND body_scan_session_id IS NOT NULL) OR
    (measurement_method = 'MANUAL_MEASUREMENTS' AND body_scan_session_id IS NULL));
CREATE INDEX ix_decisions_scan ON blueprint_decisions (body_scan_session_id) WHERE body_scan_session_id IS NOT NULL;

CREATE TABLE blueprint_measurements (               -- the exact values used, and the size each one demanded
  decision_id         uuid NOT NULL REFERENCES blueprint_decisions(id),
  chart_id            uuid NOT NULL REFERENCES size_charts(id),
  measurement_type_id uuid NOT NULL REFERENCES measurement_types(id),
  value_inches        numeric(5,1) NOT NULL CHECK (value_inches > 0),
  required_size_id    uuid NOT NULL REFERENCES sizes(id),
  PRIMARY KEY (decision_id, chart_id, measurement_type_id)
);
CREATE INDEX ix_blueprint_measurements_chart ON blueprint_measurements (chart_id);

CREATE OR REPLACE FUNCTION guard_blueprint_decisions() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'blueprint_decisions are append-only (create a new fitting decision instead)';
END $$ LANGUAGE plpgsql;
-- trg_decisions_guard from 0001 already points at this function.

CREATE FUNCTION check_blueprint_decision_insert() RETURNS trigger AS $$
DECLARE v_profile uuid; s record;
BEGIN
  SELECT measurement_profile_id INTO v_profile FROM products WHERE id = NEW.product_id;
  IF v_profile IS NULL OR v_profile <> NEW.measurement_profile_id THEN
    RAISE EXCEPTION 'The fitting profile does not match the product''s measurement profile';
  END IF;
  IF NEW.measurement_method = 'BODY_SCAN' THEN
    SELECT customer_id, product_id, status INTO s FROM body_scan_sessions WHERE id = NEW.body_scan_session_id;
    IF NOT FOUND OR s.status <> 'COMPLETED' OR s.customer_id <> NEW.customer_id OR s.product_id <> NEW.product_id THEN
      RAISE EXCEPTION 'Body scan session must be COMPLETED and belong to the same customer and product';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_decisions_insert_check BEFORE INSERT ON blueprint_decisions
  FOR EACH ROW EXECUTE FUNCTION check_blueprint_decision_insert();

CREATE FUNCTION check_blueprint_measurement_insert() RETURNS trigger AS $$
DECLARE v_profile uuid; c record;
BEGIN
  SELECT status, group_id INTO c FROM size_charts WHERE id = NEW.chart_id;
  IF c.status = 'draft' THEN RAISE EXCEPTION 'A fitting cannot use a draft size chart'; END IF;
  SELECT measurement_profile_id INTO v_profile FROM blueprint_decisions WHERE id = NEW.decision_id;
  IF NOT EXISTS (SELECT 1 FROM measurement_profile_items
                 WHERE profile_id = v_profile AND chart_group_id = c.group_id AND measurement_type_id = NEW.measurement_type_id) THEN
    RAISE EXCEPTION 'This measurement is not part of the product''s measurement profile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM size_chart_rows
                 WHERE chart_id = NEW.chart_id AND size_id = NEW.required_size_id AND measurement_type_id = NEW.measurement_type_id) THEN
    RAISE EXCEPTION 'The required size does not exist in the chart for this measurement';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_measurements_insert_check BEFORE INSERT ON blueprint_measurements
  FOR EACH ROW EXECUTE FUNCTION check_blueprint_measurement_insert();
CREATE FUNCTION forbid_blueprint_measurement_changes() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'blueprint_measurements are append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_measurements_immutable BEFORE UPDATE OR DELETE ON blueprint_measurements
  FOR EACH ROW EXECUTE FUNCTION forbid_blueprint_measurement_changes();

-- Checked at COMMIT: the fitting has every required measurement and the recommended size is the
-- LARGEST size required by any of them ("largest-required-size rule"). [DOC]
CREATE FUNCTION verify_blueprint_decision() RETURNS trigger AS $$
DECLARE v_required int; v_have int; v_max int; v_rec int;
BEGIN
  SELECT count(*) INTO v_required FROM measurement_profile_items WHERE profile_id = NEW.measurement_profile_id;
  SELECT count(*) INTO v_have FROM blueprint_measurements WHERE decision_id = NEW.id;
  IF v_have <> v_required THEN
    RAISE EXCEPTION 'Fitting record incomplete: % of % required measurements supplied', v_have, v_required;
  END IF;
  SELECT max(s.sort_order) INTO v_max FROM blueprint_measurements m JOIN sizes s ON s.id = m.required_size_id WHERE m.decision_id = NEW.id;
  SELECT sort_order INTO v_rec FROM sizes WHERE id = NEW.recommended_size_id;
  IF v_rec IS DISTINCT FROM v_max THEN
    RAISE EXCEPTION 'Recommended size is not the largest size required by the measurements';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_decisions_verify AFTER INSERT ON blueprint_decisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_blueprint_decision();

-- A8. Cart / order lines: a decision is required only for products that use Blueprint.
ALTER TABLE cart_items  ALTER COLUMN blueprint_decision_id DROP NOT NULL;
ALTER TABLE order_items ALTER COLUMN blueprint_decision_id DROP NOT NULL;
ALTER TABLE order_items ADD COLUMN fit_snapshot jsonb;       -- readable snapshot (labels, method, chart versions) for admin/returns

CREATE OR REPLACE FUNCTION check_line_matches_decision() RETURNS trigger AS $$
DECLARE v_product uuid; v_size uuid; v_profile uuid; d record; v_owner uuid;
BEGIN
  SELECT pv.product_id, pv.size_id, p.measurement_profile_id INTO v_product, v_size, v_profile
  FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = NEW.variant_id;

  IF NEW.blueprint_decision_id IS NULL THEN
    IF v_profile IS NOT NULL THEN
      RAISE EXCEPTION 'A Blueprint fitting decision is required for this product';
    END IF;
    RETURN NEW;
  END IF;

  SELECT product_id, selected_size_id, customer_id INTO d FROM blueprint_decisions WHERE id = NEW.blueprint_decision_id;
  IF v_product IS DISTINCT FROM d.product_id OR v_size IS DISTINCT FROM d.selected_size_id THEN
    RAISE EXCEPTION 'Blueprint decision does not match the selected product/size';
  END IF;
  IF TG_TABLE_NAME = 'order_items' THEN
    SELECT customer_id INTO v_owner FROM orders WHERE id = NEW.order_id;
  ELSE
    SELECT customer_id INTO v_owner FROM carts WHERE id = NEW.cart_id;
  END IF;
  IF v_owner IS DISTINCT FROM d.customer_id THEN
    RAISE EXCEPTION 'Blueprint decision belongs to a different customer than the cart/order';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- =====================================================================
-- B. RETURNS / FAULT-LINE
-- =====================================================================
ALTER TABLE return_requests ALTER COLUMN blueprint_decision_id DROP NOT NULL;   -- products without Blueprint

-- Responsibility (who is at fault) is separate from workflow status. [DOC]
ALTER TABLE return_requests RENAME COLUMN fault_classification TO responsibility;
ALTER TABLE return_requests RENAME COLUMN fault_classified_by  TO responsibility_set_by;
ALTER TABLE return_requests RENAME COLUMN fault_classified_at  TO responsibility_set_at;

CREATE TABLE fault_causes (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0
);
INSERT INTO fault_causes (code, label, sort_order) VALUES
  ('BLUEPRINT_FAILURE',                'Blueprint recommendation failed',        1),   -- [DOC]
  ('WRONG_ITEM_DELIVERED',             'Wrong item delivered',                   2),   -- [DOC: wrong/defective]
  ('DEFECTIVE_ITEM',                   'Item defective or damaged',              3),   -- [DOC]
  ('CUSTOMER_OVERRODE_RECOMMENDATION', 'Customer overrode the recommendation',   4),   -- [DOC scenario A]
  ('CHANGED_MIND',                     'Customer changed their mind',            5);   -- [DOC scenario C]
ALTER TABLE return_requests ADD COLUMN fault_cause text REFERENCES fault_causes(code);

-- 12-step workflow [DOC]. Codes are the document's names. Old 0001 codes are mapped, then removed.
INSERT INTO return_statuses (code,label,sort_order,is_terminal) VALUES
  ('SUBMITTED','Submitted',10,false),('UNDER_REVIEW','Under review',20,false),
  ('AWAITING_CUSTOMER','Awaiting customer information',25,false),('APPROVED','Approved',30,false),
  ('REJECTED','Rejected',91,true),('AWAITING_RETURN','Awaiting item return',40,false),
  ('RETURN_IN_TRANSIT','Return in transit',45,false),('RETURN_RECEIVED','Return received',50,false),
  ('EXCHANGE_PROCESSING','Exchange processing',60,false),('REFUND_PROCESSING','Refund processing',65,false),
  ('COMPLETED','Completed',90,true),('CANCELLED','Cancelled',92,true);

DROP INDEX uq_returns_one_open_per_item;
DROP INDEX ix_returns_queue;
UPDATE return_requests SET status = CASE status
  WHEN 'submitted' THEN 'SUBMITTED' WHEN 'under_review' THEN 'UNDER_REVIEW' WHEN 'approved' THEN 'APPROVED'
  WHEN 'awaiting_return' THEN 'AWAITING_RETURN' WHEN 'received' THEN 'RETURN_RECEIVED'
  WHEN 'completed' THEN 'COMPLETED' WHEN 'rejected' THEN 'REJECTED' WHEN 'cancelled' THEN 'CANCELLED' ELSE status END;
UPDATE return_request_events SET
  from_status = CASE from_status WHEN 'submitted' THEN 'SUBMITTED' WHEN 'under_review' THEN 'UNDER_REVIEW' WHEN 'approved' THEN 'APPROVED'
    WHEN 'awaiting_return' THEN 'AWAITING_RETURN' WHEN 'received' THEN 'RETURN_RECEIVED' WHEN 'completed' THEN 'COMPLETED'
    WHEN 'rejected' THEN 'REJECTED' WHEN 'cancelled' THEN 'CANCELLED' ELSE from_status END,
  to_status = CASE to_status WHEN 'submitted' THEN 'SUBMITTED' WHEN 'under_review' THEN 'UNDER_REVIEW' WHEN 'approved' THEN 'APPROVED'
    WHEN 'awaiting_return' THEN 'AWAITING_RETURN' WHEN 'received' THEN 'RETURN_RECEIVED' WHEN 'completed' THEN 'COMPLETED'
    WHEN 'rejected' THEN 'REJECTED' WHEN 'cancelled' THEN 'CANCELLED' ELSE to_status END;
ALTER TABLE return_requests ALTER COLUMN status SET DEFAULT 'SUBMITTED';
DELETE FROM return_statuses WHERE code IN ('submitted','under_review','approved','awaiting_return','received','completed','rejected','cancelled');
CREATE UNIQUE INDEX uq_returns_one_open_per_item ON return_requests (order_item_id)
  WHERE status NOT IN ('COMPLETED','REJECTED','CANCELLED');
CREATE INDEX ix_returns_queue ON return_requests (status, submitted_at)
  WHERE status NOT IN ('COMPLETED','REJECTED','CANCELLED');

-- Exchange: replacement stays linked to the original request and order item. [DOC]
ALTER TABLE return_requests
  ADD COLUMN replacement_variant_id uuid REFERENCES product_variants(id),
  ADD COLUMN inspection_outcome text CHECK (inspection_outcome IN ('RESELLABLE','NOT_RESELLABLE')),
  ADD COLUMN inspected_at timestamptz,
  ADD COLUMN inspected_by uuid REFERENCES admin_users(id),
  ADD COLUMN inspection_notes text,
  ADD CONSTRAINT ck_replacement_only_exchange CHECK (request_type = 'EXCHANGE' OR replacement_variant_id IS NULL),
  ADD CONSTRAINT ck_inspection_complete CHECK (inspection_outcome IS NULL OR (inspected_at IS NOT NULL AND inspected_by IS NOT NULL));

-- Replacement stock is reserved through the SAME reservation table (no duplicate mechanism).
ALTER TABLE stock_reservations ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE stock_reservations ADD COLUMN return_request_id uuid REFERENCES return_requests(id);
ALTER TABLE stock_reservations ADD CONSTRAINT ck_reservation_owner CHECK (num_nonnulls(order_id, return_request_id) = 1);
CREATE UNIQUE INDEX uq_reservation_return_variant ON stock_reservations (return_request_id, variant_id) WHERE return_request_id IS NOT NULL;

-- A returned item is NOT sellable until inspected. Restock movements are only accepted for
-- a request inspected RESELLABLE, for the purchased variant, never exceeding the returned quantity. [DOC]
CREATE FUNCTION guard_return_stock_movement() RETURNS trigger AS $$
DECLARE r record; v_already int;
BEGIN
  IF NEW.movement_type <> 'return' THEN RETURN NEW; END IF;
  IF NEW.reference_type IS DISTINCT FROM 'return_request' THEN
    RAISE EXCEPTION 'Return stock movements must reference a return_request';
  END IF;
  SELECT rr.quantity, rr.inspection_outcome, oi.variant_id INTO r
  FROM return_requests rr JOIN order_items oi ON oi.id = rr.order_item_id
  WHERE rr.id::text = NEW.reference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Return request not found for this stock movement'; END IF;
  IF r.inspection_outcome IS DISTINCT FROM 'RESELLABLE' THEN
    RAISE EXCEPTION 'Returned item has not been inspected as resellable';
  END IF;
  IF NEW.quantity_delta <= 0 THEN RAISE EXCEPTION 'A return restock must add stock'; END IF;
  IF NEW.variant_id <> r.variant_id THEN RAISE EXCEPTION 'Restock variant differs from the purchased variant'; END IF;
  SELECT COALESCE(sum(quantity_delta),0) INTO v_already FROM stock_movements
   WHERE movement_type = 'return' AND reference_type = 'return_request' AND reference_id = NEW.reference_id;
  IF v_already + NEW.quantity_delta > r.quantity THEN
    RAISE EXCEPTION 'Restock would exceed the returned quantity';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_stock_return_guard BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION guard_return_stock_movement();

-- Private customer evidence must never be a public file. [DOC security]
ALTER TABLE media_assets
  ADD COLUMN visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  ADD COLUMN retired_at timestamptz;                        -- replaced media is retired, never hard-deleted
CREATE FUNCTION check_return_evidence_private() RETURNS trigger AS $$
BEGIN
  IF (SELECT visibility FROM media_assets WHERE id = NEW.media_asset_id) <> 'private' THEN
    RAISE EXCEPTION 'Return evidence must be stored as a private media asset';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_return_media_private BEFORE INSERT ON return_request_media
  FOR EACH ROW EXECUTE FUNCTION check_return_evidence_private();

-- =====================================================================
-- C. HIDDEN PAGES + SERIAL ACCESS  (replaces QR-only access) [DOC]
-- QR = which page. Serial = permission. GENERAL serial -> exactly one page (never the exclusive-only page).
-- EXCLUSIVE serial -> every page. QR tokens are NOT secrets (they are printed); the serial list is.
-- =====================================================================
DROP TABLE qr_access_grants;

ALTER TABLE qr_pages
  ADD COLUMN route_token text,
  ADD COLUMN exclusive_only boolean NOT NULL DEFAULT false;     -- page 8 today; data, not a hard-coded limit
CREATE TABLE serial_import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid REFERENCES admin_users(id),
  source_name text,
  row_count   int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- [TEAM DESIGN / RECOMMENDATION] The serial list is the access secret, so only a keyed hash is stored
-- (HMAC-SHA256 of the exact serial with a server secret). Lookups are exact; no prefix rules. [DOC]
CREATE TABLE serial_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_hash     text NOT NULL UNIQUE,
  serial_hint     text,                                   -- masked display for admins, e.g. '****4821'
  category        text NOT NULL CHECK (category IN ('GENERAL','EXCLUSIVE')),
  allowed_page_id uuid REFERENCES qr_pages(id),           -- GENERAL only
  product_id      uuid REFERENCES products(id),           -- optional, not needed for the access rule [DOC]
  is_active       boolean NOT NULL DEFAULT true,
  import_batch_id uuid REFERENCES serial_import_batches(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((category = 'GENERAL' AND allowed_page_id IS NOT NULL) OR (category = 'EXCLUSIVE' AND allowed_page_id IS NULL))
);
CREATE INDEX ix_serials_page ON serial_numbers (allowed_page_id) WHERE allowed_page_id IS NOT NULL;
CREATE TRIGGER trg_serials_updated BEFORE UPDATE ON serial_numbers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- No "used" flag and no expiry: none was approved. [DOC]

CREATE FUNCTION check_serial_page() RETURNS trigger AS $$
BEGIN
  IF NEW.category = 'GENERAL' AND (SELECT exclusive_only FROM qr_pages WHERE id = NEW.allowed_page_id) THEN
    RAISE EXCEPTION 'A General serial cannot be assigned to an exclusive-only page';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_serials_page_check BEFORE INSERT OR UPDATE OF category, allowed_page_id ON serial_numbers
  FOR EACH ROW EXECUTE FUNCTION check_serial_page();

CREATE OR REPLACE FUNCTION guard_qr_pages() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'qr_pages.slug is immutable (stable internal page location)';
  END IF;
  IF OLD.token_locked_at IS NOT NULL
     AND (NEW.route_token IS DISTINCT FROM OLD.route_token OR NEW.token_locked_at IS DISTINCT FROM OLD.token_locked_at) THEN
    RAISE EXCEPTION 'The QR route token is locked (printed codes must keep working)';
  END IF;
  IF NEW.exclusive_only AND NOT OLD.exclusive_only
     AND EXISTS (SELECT 1 FROM serial_numbers WHERE allowed_page_id = NEW.id) THEN
    RAISE EXCEPTION 'General serials are already assigned to this page';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;


DROP INDEX IF EXISTS uq_qr_pages_token_hash;
ALTER TABLE qr_pages DROP COLUMN access_token_hash, DROP COLUMN token_provisioned_at;
UPDATE qr_pages SET route_token = encode(gen_random_bytes(16), 'hex') WHERE route_token IS NULL;
UPDATE qr_pages SET exclusive_only = true WHERE slot_number = 8;    -- [DOC] Page 8 never goes to a General serial
ALTER TABLE qr_pages ALTER COLUMN route_token SET NOT NULL;
CREATE UNIQUE INDEX uq_qr_pages_route_token ON qr_pages (route_token);
ALTER TABLE qr_pages ADD CONSTRAINT ck_qr_locked_needs_token CHECK (token_locked_at IS NULL OR route_token IS NOT NULL);

-- Access grants: proof that a browser (and/or logged-in customer) may open a page after serial validation.
-- A browser can hold several PAGE grants (accumulation) or one ALL grant. [DOC]
CREATE TABLE page_access_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  browser_token_hash text,                              -- hash of the random value in the visitor's HttpOnly cookie
  customer_id        uuid REFERENCES customers(id),     -- optional account persistence [TEAM DESIGN, open]
  serial_id          uuid NOT NULL REFERENCES serial_numbers(id),
  scope              text NOT NULL CHECK (scope IN ('PAGE','ALL')),
  page_id            uuid REFERENCES qr_pages(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,                       -- NULL = no expiry (TTL is a team decision)
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  CHECK (browser_token_hash IS NOT NULL OR customer_id IS NOT NULL),
  CHECK ((scope = 'PAGE' AND page_id IS NOT NULL) OR (scope = 'ALL' AND page_id IS NULL))
);
CREATE INDEX ix_grants_browser  ON page_access_grants (browser_token_hash) WHERE browser_token_hash IS NOT NULL;
CREATE INDEX ix_grants_customer ON page_access_grants (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX ix_grants_serial   ON page_access_grants (serial_id);

CREATE FUNCTION check_grant_matches_serial() RETURNS trigger AS $$
DECLARE s record;
BEGIN
  SELECT category, allowed_page_id, is_active INTO s FROM serial_numbers WHERE id = NEW.serial_id;
  IF NOT s.is_active THEN RAISE EXCEPTION 'An inactive serial cannot create an access grant'; END IF;
  IF s.category = 'GENERAL'   AND (NEW.scope <> 'PAGE' OR NEW.page_id IS DISTINCT FROM s.allowed_page_id) THEN
    RAISE EXCEPTION 'A General serial can only authorise its single assigned page';
  END IF;
  IF s.category = 'EXCLUSIVE' AND NEW.scope <> 'ALL' THEN
    RAISE EXCEPTION 'An Exclusive serial authorises all pages';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_grants_match_serial BEFORE INSERT ON page_access_grants
  FOR EACH ROW EXECUTE FUNCTION check_grant_matches_serial();

-- Audit/abuse log for serial attempts and page opens. Internal reasons may differ; API replies stay generic. [DOC]
ALTER TABLE qr_access_events DROP CONSTRAINT IF EXISTS qr_access_events_outcome_check;
ALTER TABLE qr_access_events ADD CONSTRAINT qr_access_events_outcome_check CHECK (outcome IN
  ('GRANTED','INVALID_TOKEN','PAGE_UNPUBLISHED','GRANT_VALID','GRANT_INVALID','RATE_LIMITED',
   'ROUTE_VALID','SERIAL_ACCEPTED','SERIAL_REJECTED','PAGE_LOCKED','PAGE_SERVED'));
ALTER TABLE qr_access_events ADD COLUMN serial_id uuid REFERENCES serial_numbers(id);

-- =====================================================================
-- D. CATALOGUE / SETTINGS / NOTES
-- =====================================================================
-- [DOC] No hard-coded 100-product cap or 5-page limit. NULL = unlimited.
UPDATE app_settings SET value = NULL,
  description = 'Optional cap on ACTIVE products. NULL = no cap (9 Oct design: do not hard-code 100).'
WHERE setting_key = 'catalog.max_active_products';
UPDATE app_settings SET description = '[TEAM DESIGN, open] lifetime of a hidden-page access grant in minutes. NULL = no expiry.'
WHERE setting_key = 'qr.grant_ttl_minutes';

COMMENT ON TABLE ui_translations IS 'Kept until the final location of approved static English/Pidgin copy is decided (9 Oct design). Not admin-managed.';
COMMENT ON TABLE blueprint_decisions IS 'Append-only fitting record (recommended vs final choice). Never recalculated; orders and returns reference it.';
COMMENT ON TABLE blueprint_measurements IS 'Exact measurement values and per-measurement required size used by a fitting decision.';
COMMENT ON TABLE serial_numbers IS 'Client-supplied outfit serials, stored as keyed hashes. Never expose through any public API.';
COMMENT ON TABLE qr_pages IS 'The hidden pages (8 today). Content is developer-managed. route_token is printed in the QR and is NOT a secret; access needs a valid serial.';
COMMENT ON TABLE product_translations IS 'Product descriptions are canonical; the English/Pidgin toggle covers static site copy only (9 Oct design). Keep for future use; do not build admin translation management.';
