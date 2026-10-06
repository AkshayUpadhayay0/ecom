-- Urban Ibile - Seed data v2 (run AFTER urban_ibile_schema_v2.sql). Safe to re-run.
-- Everything marked SAMPLE must be replaced/confirmed by the client before launch.
-- NOTE: the first admin account is NOT seeded here (password hashes must be created by the app,
--       e.g. `npm run admin:create`). Never commit credentials.
BEGIN;

-- Sizes (SAMPLE labels; final list comes with the brand size chart)
INSERT INTO sizes (code,label,sort_order) VALUES
  ('S','Small',1),('M','Medium',2),('L','Large',3),('XL','Extra Large',4),('XXL','2X Large',5)
ON CONFLICT (code) DO NOTHING;

-- Clothing types (admin-managed; keywords help search match synonyms)
INSERT INTO clothing_types (slug, search_keywords, sort_order) VALUES
  ('shirt',   'shirts top tops',            1),
  ('trouser', 'trousers pants pant slacks', 2)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO clothing_type_translations (clothing_type_id, language_code, name)
SELECT id, 'en', initcap(slug) FROM clothing_types WHERE slug IN ('shirt','trouser')
ON CONFLICT DO NOTHING;

-- Measurement types (SAMPLE: client must confirm which measurements are required)
INSERT INTO measurement_types (code, unit, sort_order) VALUES
  ('chest','cm',1),('waist','cm',2),('hip','cm',3)
ON CONFLICT (code) DO NOTHING;
INSERT INTO measurement_type_translations (measurement_type_id, language_code, label)
SELECT id, 'en', initcap(code) FROM measurement_types
ON CONFLICT DO NOTHING;

-- SAMPLE size chart (is_sample_data = true; production must not use it)
INSERT INTO size_charts (name, status, is_sample_data)
SELECT 'SAMPLE chart - development only', 'active', true
WHERE NOT EXISTS (SELECT 1 FROM size_charts WHERE name = 'SAMPLE chart - development only');

INSERT INTO size_chart_ranges (size_chart_id, size_id, measurement_type_id, min_value, max_value)
SELECT c.id, s.id, m.id, v.minv, v.maxv
FROM size_charts c
JOIN (VALUES
  ('S','chest',84,91.99),('M','chest',92,99.99),('L','chest',100,107.99),('XL','chest',108,115.99),('XXL','chest',116,125)
) AS v(size_code, meas_code, minv, maxv) ON true
JOIN sizes s ON s.code = v.size_code
JOIN measurement_types m ON m.code = v.meas_code
WHERE c.name = 'SAMPLE chart - development only'
ON CONFLICT DO NOTHING;

-- Delivery zones: SAMPLE, inactive and fee-less until the client supplies real data [PENDING]
INSERT INTO delivery_zones (code, name, fee_minor, is_active, is_sample_data, sort_order) VALUES
  ('sample-a','SAMPLE zone A',NULL,false,true,1),
  ('sample-b','SAMPLE zone B',NULL,false,true,2)
ON CONFLICT (code) DO NOTHING;

-- 14 QR content pages. Slugs are random, generated ONCE, and immutable (trigger).
-- Re-running never changes an existing slug.
INSERT INTO qr_pages (slot_number, slug)
SELECT n, 'p-' || encode(gen_random_bytes(6), 'hex')
FROM generate_series(1,14) AS n
ON CONFLICT (slot_number) DO NOTHING;
INSERT INTO qr_page_translations (qr_page_id, language_code, title, body)
SELECT id, 'en', 'Page ' || slot_number || ' (temporary)', 'Temporary content. Replace from the admin panel.'
FROM qr_pages
ON CONFLICT DO NOTHING;

-- Content blocks
INSERT INTO content_blocks (block_key) VALUES
  ('home.hero'),('policy.returns'),('policy.privacy'),('policy.terms'),('footer.about')
ON CONFLICT (block_key) DO NOTHING;
INSERT INTO content_block_translations (content_block_id, language_code, title, body, cta_label)
SELECT id, 'en',
  CASE block_key WHEN 'home.hero' THEN 'Urban Ibile' ELSE initcap(replace(block_key,'.',' ')) END,
  CASE block_key WHEN 'home.hero' THEN 'Temporary hero message.' ELSE 'Content pending from client.' END,
  CASE block_key WHEN 'home.hero' THEN 'Shop now' END
FROM content_blocks
ON CONFLICT DO NOTHING;

-- Required UI string (exact wording from the brief) + a few starters; full list is generated from the app's key catalogue
INSERT INTO ui_translations (translation_key, language_code, value, is_approved) VALUES
  ('search.no_results','en','No outfits found. Try another word.',true),
  ('cart.proceed_to_checkout','en','Proceed to checkout',true),
  ('nav.shop','en','Shop',true),
  ('order.status.being_prepared','en','Being prepared',true),
  ('order.status.sent_out','en','Sent out',true),
  ('order.status.delivered','en','Delivered',true)
ON CONFLICT (translation_key, language_code) DO NOTHING;

COMMIT;
