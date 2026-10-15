-- 0008 - Paystack payments, order confirmation, email outbox (Phase 6). Additive only.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

-- Money arrived but the order cannot be fulfilled normally (late payment with no stock left,
-- or Paystack success with an amount / currency / order mismatch). System-managed; an admin
-- resolves it (Phase 7). Refund policy is a Pending Client Decision.
INSERT INTO order_statuses (code, label, sort_order, is_admin_selectable, is_terminal) VALUES
  ('payment_review', 'Payment received - needs attention', 17, false, false)
ON CONFLICT (code) DO NOTHING;

-- needs_review: money may have been taken but was NOT applied to the order (mismatch, or a second
-- success on an already-paid order). Not 'success', so uq_one_success_per_order stays meaningful.
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN
  ('initiated','pending','success','failed','abandoned','refunded','needs_review'));

-- Why a payment did not succeed / needs review (DECLINED, ABANDONED, AMOUNT_MISMATCH,
-- CURRENCY_MISMATCH, ORDER_MISMATCH, DUPLICATE_SUCCESS, ...). Never contains card data.
ALTER TABLE payments ADD COLUMN failure_reason text;
-- Last time the reconciliation job asked the provider about this attempt.
ALTER TABLE payments ADD COLUMN last_checked_at timestamptz;
CREATE INDEX ix_payments_unresolved ON payments (created_at) WHERE status IN ('initiated','pending');

INSERT INTO app_settings (setting_key, value, description) VALUES
  ('payments.reconcile_after_minutes', '5',
   '[TEAM DESIGN] unresolved payment attempts older than this are verified by the worker'),
  ('payments.reconcile_max_age_hours', '48',
   '[TEAM DESIGN] unresolved attempts older than this are marked abandoned'),
  ('payments.reconcile_batch', '50', '[TEAM DESIGN] attempts verified per reconciliation run'),
  ('email.max_attempts', '5', '[TEAM DESIGN] delivery attempts before an outbox email is marked failed'),
  ('email.retry_base_seconds', '60', '[TEAM DESIGN] retry backoff base (base * attempts^2)')
ON CONFLICT (setting_key) DO NOTHING;
