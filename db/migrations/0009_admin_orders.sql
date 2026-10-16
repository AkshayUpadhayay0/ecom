-- 0009 - Admin order management, order notes, payment review resolutions (Phase 7a). Additive.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

-- 1. Allowed admin status changes (data-driven: a new status = new order_statuses row + rows here).
CREATE TABLE order_status_transitions (
  from_status     text NOT NULL REFERENCES order_statuses(code),
  to_status       text NOT NULL REFERENCES order_statuses(code),
  requires_paid   boolean NOT NULL DEFAULT false,   -- order must have payment_status = 'paid'
  requires_reason boolean NOT NULL DEFAULT false,   -- admin must give a reason (e.g. cancellation)
  is_active       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (from_status, to_status),
  CHECK (from_status <> to_status)
);
INSERT INTO order_statuses (code, label, sort_order, is_admin_selectable, is_terminal) VALUES
  ('payment_review', 'Payment received - needs attention', 17, false, false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO order_status_transitions (from_status, to_status, requires_paid, requires_reason) VALUES
  ('pending_payment', 'being_prepared', true,  false),  -- [CONFIRMED] paid -> being prepared
  ('being_prepared',  'sent_out',       true,  false),  -- [CONFIRMED]
  ('sent_out',        'delivered',      true,  false),  -- [CONFIRMED]
  ('pending_payment', 'cancelled',      false, true);   -- [DECISION 16 Oct 2026] unpaid only, reason required
-- Paid orders cannot be cancelled here: refund / cancellation policy is a Pending Client Decision.
-- payment_review is never a target (resolved through the payment review queue).

-- 2. Internal notes on orders: append-only, admin only, never shown to customers.
CREATE TABLE order_notes (
  id         bigserial PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES orders(id),
  admin_id   uuid NOT NULL REFERENCES admin_users(id),
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_notes_order ON order_notes (order_id, created_at);

CREATE FUNCTION forbid_order_note_changes() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'order_notes are append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_order_notes_immutable BEFORE UPDATE OR DELETE ON order_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_order_note_changes();

-- 3. Admin decisions on payments that need review. Append-only; one row per (payment, action).
--    No refund is executed by the system (refund policy: Pending Client Decision); these rows
--    record what is owed / what was done manually in the Paystack dashboard.
CREATE TABLE payment_review_resolutions (
  id               bigserial PRIMARY KEY,
  payment_id       uuid NOT NULL REFERENCES payments(id),
  order_id         uuid NOT NULL REFERENCES orders(id),
  action           text NOT NULL CHECK (action IN ('FULFIL', 'MARK_REFUND_REQUIRED', 'MARK_REFUNDED')),
  amount_minor     bigint CHECK (amount_minor > 0),
  refund_reference text CHECK (length(btrim(refund_reference)) BETWEEN 1 AND 200),
  note             text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  admin_id         uuid NOT NULL REFERENCES admin_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (action <> 'MARK_REFUND_REQUIRED' OR amount_minor IS NOT NULL),
  CHECK (action <> 'MARK_REFUNDED' OR refund_reference IS NOT NULL)
);
CREATE UNIQUE INDEX uq_review_resolution_action ON payment_review_resolutions (payment_id, action);
CREATE INDEX ix_review_resolutions_order ON payment_review_resolutions (order_id);

CREATE FUNCTION forbid_review_resolution_changes() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'payment_review_resolutions are append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_review_resolutions_immutable BEFORE UPDATE OR DELETE ON payment_review_resolutions
  FOR EACH ROW EXECUTE FUNCTION forbid_review_resolution_changes();

-- 4. One customer status email per order and transition.
CREATE UNIQUE INDEX uq_outbox_order_status_email ON email_outbox (order_id, template)
  WHERE template IN ('order_sent_out', 'order_delivered');

-- 5. Admin order list / stats / search indexes.
CREATE INDEX ix_orders_placed ON orders (placed_at DESC, id);
CREATE INDEX ix_orders_status_placed ON orders (order_status, placed_at DESC);
CREATE INDEX ix_orders_payment_status_placed ON orders (payment_status, placed_at DESC);
CREATE INDEX ix_orders_zone_placed ON orders (delivery_zone_id, placed_at DESC);
CREATE INDEX ix_orders_paid_at ON orders (paid_at) WHERE payment_status = 'paid';
CREATE INDEX ix_payments_needs_review ON payments (created_at) WHERE status = 'needs_review';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_orders_search_trgm ON orders USING gin (
  (order_number || ' ' || contact_email::text || ' ' || contact_phone || ' ' || recipient_name) gin_trgm_ops);
CREATE INDEX ix_customers_search_trgm ON customers USING gin (
  (full_name || ' ' || email::text || ' ' || coalesce(phone, '')) gin_trgm_ops);
