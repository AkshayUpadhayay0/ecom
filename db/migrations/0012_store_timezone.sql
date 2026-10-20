-- 0012: store time zone (tester fixes, 20 Oct 2026). Purely additive.
--
-- [TECHNICAL RECOMMENDATION] The client is Nigeria-based, so business dates use Africa/Lagos:
-- "today / 7 days / 30 days" on the dashboard, date-only list filters and every date and time
-- shown in the admin app. Stored timestamps stay UTC. super_admin only (store.* is sensitive).

INSERT INTO app_settings (setting_key, value, description) VALUES
  ('store.timezone', '"Africa/Lagos"',
   '[TECHNICAL RECOMMENDATION] IANA time zone for business dates and admin display (client is Nigeria-based)')
ON CONFLICT (setting_key) DO NOTHING;
