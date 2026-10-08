-- Seed for migration 0002 (run AFTER 0002_requirements_v2.sql). Safe to re-run.
-- Applied by `pnpm db:seed` (ecom) and `pnpm db:test:setup` (ecom_test).
-- EVERYTHING BELOW IS SAMPLE / PLACEHOLDER. The real Blueprint mapping comes from the tailor (PENDING).
-- Sample rules are NOT brand data. The API must refuse is_sample_data = true rule sets when NODE_ENV=production.
BEGIN;

-- SAMPLE Blueprint rule set v1 (default scope, no garment cut).
INSERT INTO blueprint_rule_sets (version, name, status, is_sample_data, notes)
SELECT 1, 'SAMPLE rules - development only', 'draft', true, 'Invented for development. Replace with tailor data.'
WHERE NOT EXISTS (SELECT 1 FROM blueprint_rule_sets WHERE garment_cut_id IS NULL AND version = 1);

INSERT INTO blueprint_rules (rule_set_id, fit_preference, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg, size_id)
SELECT rs.id, v.fit, 140, 220, v.wmin, v.wmax, s.id
FROM blueprint_rule_sets rs
JOIN (VALUES
  ('standard', 30,  60,'S'), ('standard', 60,  72,'M'), ('standard', 72,  85,'L'), ('standard', 85, 100,'XL'), ('standard',100,150,'XXL'),
  ('tailored', 30,  60,'M'), ('tailored', 60,  72,'L'), ('tailored', 72,  85,'XL'),('tailored', 85, 100,'XXL'),('tailored',100,150,'XXL'),
  ('oversized',30,  60,'S'), ('oversized',60,  72,'S'), ('oversized',72,  85,'M'), ('oversized',85, 100,'L'),  ('oversized',100,150,'XL')
) AS v(fit, wmin, wmax, size_code) ON true
JOIN sizes s ON s.code = v.size_code
WHERE rs.garment_cut_id IS NULL AND rs.version = 1 AND rs.status = 'draft'
  AND NOT EXISTS (SELECT 1 FROM blueprint_rules r WHERE r.rule_set_id = rs.id);

-- Activate the sample set so Find My Size works in development.
UPDATE blueprint_rule_sets SET status = 'active'
WHERE garment_cut_id IS NULL AND version = 1 AND status = 'draft' AND is_sample_data;

-- Secret page placeholders (8). Content is developer-managed; slugs/tokens are NOT touched here.
UPDATE qr_page_translations t
SET title = 'Secret Page ' || p.slot_number || ' (placeholder)',
    body  = 'Placeholder content. Final write-up will be added by the developers when the company supplies it.'
FROM qr_pages p
WHERE t.qr_page_id = p.id AND t.language_code = 'en' AND p.slot_number BETWEEN 1 AND 8
  AND t.title LIKE 'Page % (temporary)';

-- Default (empty) return policy: nothing is decided yet [TEAM DESIGN / PENDING]. Active so requests can be created in dev.
INSERT INTO return_policies (version, name, status, notes, effective_from)
SELECT 1, 'DRAFT policy - window/condition rules not decided', 'active',
       'All rule fields are NULL on purpose. Do not enforce any window or condition until the team finalises the policy.', now()
WHERE NOT EXISTS (SELECT 1 FROM return_policies WHERE version = 1);

COMMIT;
