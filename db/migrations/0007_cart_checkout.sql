-- 0007 - Cart + checkout (Phase 5b). Additive only.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

-- Price shown when the line was added/last changed, ONLY to warn "price changed" in the cart.
-- Orders always use products.price_minor at checkout (never this value).
ALTER TABLE cart_items ADD COLUMN added_unit_price_minor bigint CHECK (added_unit_price_minor >= 0);

INSERT INTO app_settings (setting_key, value, description) VALUES
  ('store.currency', '"NGN"', '[ASSUMPTION] currency of every price and order (ISO 4217)'),
  ('checkout.reservation_max_total_minutes', '45',
   '[TEAM DESIGN] longest a checkout may keep stock reserved (re-submitting an unchanged checkout extends the hold up to this)')
ON CONFLICT (setting_key) DO NOTHING;
