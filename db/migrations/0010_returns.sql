-- 0010 - Returns / Exchange / Fault-Line workflow (Phase 7b). Additive only.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

-- 1. Replacement shipping for exchanges (decision 16 Oct 2026).
INSERT INTO return_statuses (code, label, sort_order, is_terminal) VALUES
  ('EXCHANGE_SENT', 'Replacement sent', 70, false)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE return_requests
  ADD COLUMN replacement_carrier text CHECK (length(btrim(replacement_carrier)) BETWEEN 1 AND 100),
  ADD COLUMN replacement_tracking_reference text CHECK (length(btrim(replacement_tracking_reference)) BETWEEN 1 AND 200),
  ADD COLUMN replacement_sent_at timestamptz,
  -- Recorded only when the active policy requires the condition (NULL rule = not asked).
  ADD COLUMN confirmed_original_tags boolean,
  ADD COLUMN confirmed_unworn_unwashed boolean;

-- 2. Allowed workflow changes (data-driven; a new status = return_statuses row + rows here).
CREATE TABLE return_status_transitions (
  from_status         text NOT NULL REFERENCES return_statuses(code),
  to_status           text NOT NULL REFERENCES return_statuses(code),
  actor               text NOT NULL CHECK (actor IN ('ADMIN', 'CUSTOMER')),
  request_type        text CHECK (request_type IN ('RETURN', 'EXCHANGE')),  -- NULL = both
  requires_reason     boolean NOT NULL DEFAULT false,
  requires_inspection boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (from_status, to_status, actor),
  CHECK (from_status <> to_status)
);
INSERT INTO return_status_transitions (from_status, to_status, actor, request_type, requires_reason, requires_inspection) VALUES
  ('SUBMITTED',           'UNDER_REVIEW',        'ADMIN',    NULL,       false, false),
  ('SUBMITTED',           'APPROVED',            'ADMIN',    NULL,       false, false),
  ('UNDER_REVIEW',        'APPROVED',            'ADMIN',    NULL,       false, false),
  ('APPROVED',            'AWAITING_RETURN',     'ADMIN',    NULL,       false, false),
  ('SUBMITTED',           'REJECTED',            'ADMIN',    NULL,       true,  false),
  ('UNDER_REVIEW',        'REJECTED',            'ADMIN',    NULL,       true,  false),
  ('SUBMITTED',           'AWAITING_CUSTOMER',   'ADMIN',    NULL,       true,  false),
  ('UNDER_REVIEW',        'AWAITING_CUSTOMER',   'ADMIN',    NULL,       true,  false),
  ('AWAITING_CUSTOMER',   'UNDER_REVIEW',        'CUSTOMER', NULL,       false, false),
  ('AWAITING_RETURN',     'RETURN_IN_TRANSIT',   'ADMIN',    NULL,       false, false),
  ('AWAITING_RETURN',     'RETURN_RECEIVED',     'ADMIN',    NULL,       false, false),
  ('RETURN_IN_TRANSIT',   'RETURN_RECEIVED',     'ADMIN',    NULL,       false, false),
  ('RETURN_RECEIVED',     'EXCHANGE_PROCESSING', 'ADMIN',    'EXCHANGE', false, true),
  ('RETURN_RECEIVED',     'REFUND_PROCESSING',   'ADMIN',    'RETURN',   false, true),
  ('EXCHANGE_PROCESSING', 'EXCHANGE_SENT',       'ADMIN',    'EXCHANGE', false, false),
  ('EXCHANGE_SENT',       'COMPLETED',           'ADMIN',    'EXCHANGE', false, false),
  ('REFUND_PROCESSING',   'COMPLETED',           'ADMIN',    'RETURN',   false, false),
  ('SUBMITTED',           'CANCELLED',           'CUSTOMER', NULL,       false, false),
  ('UNDER_REVIEW',        'CANCELLED',           'CUSTOMER', NULL,       false, false),
  ('AWAITING_CUSTOMER',   'CANCELLED',           'CUSTOMER', NULL,       false, false),
  ('APPROVED',            'CANCELLED',           'CUSTOMER', NULL,       false, false),
  ('AWAITING_RETURN',     'CANCELLED',           'CUSTOMER', NULL,       false, false);

-- 3. Timeline visibility (admin notes are INTERNAL) + append-only events.
ALTER TABLE return_request_events
  ADD COLUMN visibility text NOT NULL DEFAULT 'CUSTOMER' CHECK (visibility IN ('CUSTOMER', 'INTERNAL'));
CREATE FUNCTION forbid_return_event_changes() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'return_request_events are append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_return_events_immutable BEFORE UPDATE OR DELETE ON return_request_events
  FOR EACH ROW EXECUTE FUNCTION forbid_return_event_changes();

-- 4. Customer-owned uploads (return evidence). Always private.
ALTER TABLE media_assets
  ADD COLUMN owner_customer_id uuid REFERENCES customers(id),
  ADD CONSTRAINT media_customer_owned_private CHECK (owner_customer_id IS NULL OR visibility = 'private');
CREATE INDEX ix_media_owner_customer ON media_assets (owner_customer_id, created_at DESC)
  WHERE owner_customer_id IS NOT NULL;

-- 5. Once-per-event emails (e.g. several "more information" rounds on one request).
ALTER TABLE email_outbox ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX uq_outbox_dedupe_key ON email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 6. Admin list indexes.
CREATE INDEX ix_returns_submitted ON return_requests (submitted_at DESC, id);
CREATE INDEX ix_returns_responsibility ON return_requests (responsibility, submitted_at DESC);

-- 7. Settings. [TEAM DESIGN] evidence limits; [PENDING CLIENT DECISION] address / instructions.
INSERT INTO app_settings (setting_key, value, description) VALUES
  ('returns.evidence_max_files', '5', '[TEAM DESIGN] evidence photos per request / reply'),
  ('returns.evidence_max_bytes', '10485760', '[TEAM DESIGN] max size of one evidence photo (bytes)'),
  ('returns.return_address',
   '"PLACEHOLDER - return address not decided yet (Pending Client Decision)"',
   '[PENDING CLIENT DECISION] where customers send returned items; shown in the approval email'),
  ('returns.return_instructions',
   '"PLACEHOLDER - return instructions not decided yet (Pending Client Decision)"',
   '[PENDING CLIENT DECISION] packing / dispatch instructions shown in the approval email')
ON CONFLICT (setting_key) DO NOTHING;
