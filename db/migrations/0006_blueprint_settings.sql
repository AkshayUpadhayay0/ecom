-- 0006 - Blueprint engine settings (Phase 5a). Settings rows only; no schema change.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

INSERT INTO app_settings (setting_key, value, description) VALUES
  ('blueprint.measurement_limits',
   '{"default": {"min": 5, "max": 90}, "byMeasurement": {"head_circumference": {"min": 15, "max": 30}}}',
   '[SAMPLE] sane input range in inches per measurement code (rejects typos such as 400). Not size rules; confirm with the tailor.'),
  ('blueprint.reject_below_chart_min', 'false',
   '[PENDING CLIENT DECISION] when true, a value below the smallest size''s minimum is out of range instead of mapping to the smallest size'),
  ('body_scan.session_ttl_minutes', '30',
   '[TEAM DESIGN] how long a Body Scan session stays open')
ON CONFLICT (setting_key) DO NOTHING;
