/**
 * Seeds the data the Playwright tests need into the TEST database and removes it again.
 *
 *   pnpm --filter @urban-ibile/web e2e:seed             seed (idempotent: cleans first)
 *   pnpm --filter @urban-ibile/web e2e:cleanup          remove everything this script created
 *
 * SAFETY: this script refuses to run unless the target database name ends in "_test". It never
 * reads DATABASE_URL as-is: it uses TEST_DATABASE_URL, or derives "<name>_test" from DATABASE_URL
 * (same rule as the API's test setup). Everything it creates is recognisable (slug "e2e-*", media
 * keys "media/e2e/*") so cleanup removes exactly that and nothing else.
 *
 * Prerequisite: `pnpm db:test:setup` (schema + migrations + reference data in ecom_test).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { databaseName, resolveTestUrl } from './test-db';

const KEY_PREFIX = 'media/e2e';
const ZONE_CODE = 'e2e-lagos';
/** Customers the e2e tests register (see tests/e2e/mail.ts): removed on clean-up. */
const TEST_EMAIL_PATTERN = 'e2e-%@example.test';
const SLUG_PREFIX = 'e2e-';
const BULK_PRODUCTS = 25;
const VIDEO_PRODUCTS = BULK_PRODUCTS; // every grid card has a (real, tiny) video, so autoplay can be tested above and below the fold
const PLAYABLE_MP4 = fileURLToPath(new URL('../tests/fixtures/preview.mp4', import.meta.url));
export const E2E_MAIL_DIR = fileURLToPath(new URL('../e2e-mail/', import.meta.url));
export const E2E_MEDIA_DIR = fileURLToPath(new URL('../e2e-media/', import.meta.url));

interface MediaSet {
  assetId: string;
}

async function writeObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const path = new URL(`public/${key}`, `file:///${E2E_MEDIA_DIR.replace(/\\/g, '/')}`);
  const file = fileURLToPath(path);
  await mkdir(fileURLToPath(new URL('.', path)), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
}

async function cleanup(client: pg.Client): Promise<void> {
  await client.query(
    `UPDATE content_blocks SET media_asset_id = NULL
     WHERE media_asset_id IN (SELECT id FROM media_assets WHERE original_key LIKE $1)`,
    [`${KEY_PREFIX}/%`],
  );
  // Customers first (their carts and Blueprint decisions reference the products), then products,
  // then the zone. purge() walks the foreign keys, with triggers off for append-only tables.
  await client.query(`SET LOCAL session_replication_role = replica`);
  await purge(client, 'customers', 'email LIKE $1', [TEST_EMAIL_PATTERN]);
  await purge(client, 'products', 'slug LIKE $1', [`${SLUG_PREFIX}%`]);
  await purge(client, 'delivery_zones', 'code = $1', [ZONE_CODE]);
  await client.query(`SET LOCAL session_replication_role = DEFAULT`);
  await client.query(`DELETE FROM media_assets WHERE original_key LIKE $1`, [`${KEY_PREFIX}/%`]);
  await rm(E2E_MEDIA_DIR, { recursive: true, force: true });
  await rm(E2E_MAIL_DIR, { recursive: true, force: true });
}
interface ForeignKey {
  child: string;
  childColumn: string;
  parentColumn: string;
}

async function foreignKeysTo(client: pg.Client, table: string): Promise<ForeignKey[]> {
  const { rows } = await client.query<{ child: string; child_col: string; parent_col: string }>(
    `SELECT c.conrelid::regclass::text AS child, a.attname AS child_col, af.attname AS parent_col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1`,
    [table],
  );
  return rows.map((row) => ({
    child: row.child,
    childColumn: row.child_col,
    parentColumn: row.parent_col,
  }));
}

/** Deepest foreign-key chain followed when removing test data (guards against cycles). */
const MAX_PURGE_DEPTH = 8;

/**
 * Deletes the rows of `table` matching `where`, then the rows that reference them (found from the
 * foreign keys), using the key values of the deleted rows: a few small queries per table instead of
 * nested sub-selects. Triggers and foreign-key checks are switched off for the transaction
 * (session_replication_role = replica) because append-only guards (Blueprint decisions, ledgers)
 * would otherwise refuse the clean-up. Only ever reached for the *_test database (see test-db.ts).
 */
async function purge(
  client: pg.Client,
  table: string,
  where: string,
  params: unknown[],
  depth = 0,
): Promise<void> {
  const { rows } = await client.query<Record<string, unknown>>(
    `DELETE FROM ${table} WHERE ${where} RETURNING *`,
    params,
  );
  if (rows.length === 0 || depth >= MAX_PURGE_DEPTH) return;
  for (const fk of await foreignKeysTo(client, table)) {
    const values = [...new Set(rows.map((row) => row[fk.parentColumn]).filter((v) => v != null))];
    if (values.length > 0) {
      await purge(client, fk.child, `${fk.childColumn} = ANY($1)`, [values], depth + 1);
    }
  }
}
async function makeJpeg(_color: string, width: number, height: number): Promise<Buffer> {
  // Blurred random texture, photo-like in weight: a solid image would be ignored by LCP.
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .blur(3)
    .modulate({ brightness: 1.1 })
    .jpeg({ quality: 70 })
    .toBuffer();
}
async function makeWebp(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .webp()
    .toBuffer();
}

async function insertVideo(client: pg.Client, label: string, color: string): Promise<MediaSet> {
  const id = (
    await client.query<{ id: string }>(
      `INSERT INTO media_assets (kind, original_key, mime_type, size_bytes, processing_status, visibility,
                                 width, height, duration_ms, dominant_color)
       VALUES ('video', $1, 'video/mp4', 1000, 'ready', 'public', 720, 1280, 4000, $2) RETURNING id`,
      [`${KEY_PREFIX}/${label}/original.mp4`, color],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('video insert failed');
  const renditions: [string, string, number, number][] = [
    ['480p', 'mp4', 480, 854],
    ['720p', 'mp4', 720, 1280],
    ['preview', 'mp4', 480, 854],
    ['poster', 'jpg', 720, 900],
  ];
  const poster = await makeJpeg(color, 720, 900);
  for (const [name, format, width, height] of renditions) {
    const key = `${KEY_PREFIX}/${label}/${name}.${format}`;
    // Posters are real JPEGs and every MP4 is a real, tiny, playable H.264 clip (tests/fixtures,
    // made with ffmpeg), so the website's autoplay can be tested for real.
    await writeObject(
      key,
      format === 'jpg' ? poster : await readFile(PLAYABLE_MP4),
      format === 'jpg' ? 'image/jpeg' : 'video/mp4',
    );
    await client.query(
      `INSERT INTO media_renditions (asset_id, label, format, storage_key, width, height, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,100)`,
      [id, name, format, key, width, height],
    );
  }
  return { assetId: id };
}

async function insertImage(client: pg.Client, label: string, color: string): Promise<MediaSet> {
  const id = (
    await client.query<{ id: string }>(
      `INSERT INTO media_assets (kind, original_key, mime_type, size_bytes, processing_status, visibility,
                                 width, height, dominant_color)
       VALUES ('image', $1, 'image/jpeg', 1000, 'ready', 'public', 1280, 1600, $2) RETURNING id`,
      [`${KEY_PREFIX}/${label}/original.jpg`, color],
    )
  ).rows[0]?.id;
  if (!id) throw new Error('image insert failed');
  for (const width of [320, 640, 1280]) {
    const height = Math.round(width * 1.25);
    const key = `${KEY_PREFIX}/${label}/w${width}.webp`;
    await writeObject(key, await makeWebp(color, width, height), 'image/webp');
    await client.query(
      `INSERT INTO media_renditions (asset_id, label, format, storage_key, width, height, size_bytes)
       VALUES ($1,$2,'webp',$3,$4,$5,100)`,
      [id, `w${width}`, key, width, height],
    );
  }
  return { assetId: id };
}

async function seed(client: pg.Client): Promise<void> {
  const typeId = async (slug: string): Promise<string> =>
    (await client.query<{ id: string }>('SELECT id FROM clothing_types WHERE slug = $1', [slug]))
      .rows[0]?.id ??
    (() => {
      throw new Error(`clothing type "${slug}" missing: run pnpm db:test:setup`);
    })();
  const sizeId = async (code: string): Promise<string> =>
    (await client.query<{ id: string }>('SELECT id FROM sizes WHERE code = $1', [code])).rows[0]
      ?.id ??
    (() => {
      throw new Error(`size "${code}" missing: run pnpm db:test:setup`);
    })();
  const shirt = await typeId('shirt');
  const trouser = await typeId('trouser');
  const sizeM = await sizeId('M');
  const sizeL = await sizeId('L');
  const profile =
    (
      await client.query<{ id: string }>(
        `SELECT id FROM measurement_profiles WHERE code = 'male_top'`,
      )
    ).rows[0]?.id ?? null;

  async function product(input: {
    slug: string;
    name: string;
    type: string;
    price: number;
    ageSeconds: number;
    videoAssetId?: string | null;
    profileId?: string | null;
    description?: string;
    keywords?: string;
    variants: [string, number][];
  }): Promise<string> {
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO products (slug, name, clothing_type_id, price_minor, status, search_keywords, video_asset_id,
                               measurement_profile_id, created_at)
         VALUES ($1,$2,$3,$4,'active',$5,$6,$7, now() - make_interval(secs => $8)) RETURNING id`,
        [
          input.slug,
          input.name,
          input.type,
          input.price,
          input.keywords ?? '',
          input.videoAssetId ?? null,
          input.profileId ?? null,
          input.ageSeconds,
        ],
      )
    ).rows[0]?.id;
    if (!id) throw new Error('product insert failed');
    if (input.description) {
      await client.query(
        `INSERT INTO product_translations (product_id, language_code, description) VALUES ($1,'en',$2)`,
        [id, input.description],
      );
    }
    for (const [size, stock] of input.variants) {
      await client.query(
        `INSERT INTO product_variants (product_id, size_id, sku, stock_on_hand, low_stock_threshold)
         VALUES ($1,$2,$3,$4,3)`,
        [id, size, `E2E-${input.slug}-${size.slice(0, 4)}`, stock],
      );
    }
    return id;
  }

  // 25 newest products. The first few have a (mock) video; the rest show an image or nothing.
  for (let n = 1; n <= BULK_PRODUCTS; n += 1) {
    const slug = `${SLUG_PREFIX}outfit-${String(n).padStart(2, '0')}`;
    const video = n <= VIDEO_PRODUCTS ? await insertVideo(client, slug, '#2a4d69') : null;
    await product({
      slug,
      name: `E2E Outfit ${String(n).padStart(2, '0')}`,
      type: n % 2 === 0 ? trouser : shirt,
      price: 3_500_000 + n * 10_000,
      ageSeconds: n,
      videoAssetId: video?.assetId ?? null,
      variants: [[sizeM, 5]],
    });
  }

  // Oldest product: lands beyond page 1 in "newest" order, found by search.
  await product({
    slug: `${SLUG_PREFIX}zanzibar-linen-agbada`,
    name: 'Zanzibar Linen Agbada',
    type: trouser,
    price: 12_500_050,
    ageSeconds: 100_000,
    description: 'Hand-finished linen agbada.\nSecond line of the description.',
    variants: [[sizeL, 4]],
  });

  // Video + Blueprint profile + several size states.
  const withVideo = await insertVideo(client, 'detail-video', '#b0703a');
  const withImage = await insertImage(client, 'detail-image', '#3a7a5c');
  const detailId = await product({
    slug: `${SLUG_PREFIX}with-video`,
    name: 'E2E Video Kaftan',
    type: shirt,
    price: 4_200_000,
    ageSeconds: 50_000,
    videoAssetId: withVideo.assetId,
    profileId: profile,
    description: 'A kaftan with a ready video.',
    variants: [
      [sizeM, 0],
      [sizeL, 2],
      [await sizeId('XL'), 9],
    ],
  });
  await client.query(
    `INSERT INTO product_images (product_id, media_asset_id, sort_order) VALUES ($1,$2,0)`,
    [detailId, withImage.assetId],
  );

  // No ready video: one image only (poster fallback, no broken player).
  const noVideoImage = await insertImage(client, 'no-video-image', '#8a3b2b');
  const noVideoId = await product({
    slug: `${SLUG_PREFIX}no-video`,
    name: 'E2E No Video Shirt',
    type: shirt,
    price: 1_000_000,
    ageSeconds: 40_000,
    description: 'A product without a video.',
    variants: [[sizeM, 5]],
  });
  await client.query(
    `INSERT INTO product_images (product_id, media_asset_id, sort_order) VALUES ($1,$2,0)`,
    [noVideoId, noVideoImage.assetId],
  );

  // Sold out (still listed, flagged out of stock).
  await product({
    slug: `${SLUG_PREFIX}sold-out`,
    name: 'E2E Sold Out Trouser',
    type: trouser,
    price: 900_000,
    ageSeconds: 30_000,
    variants: [[sizeM, 0]],
  });

  // No measurement profile: the shopper picks a size directly. Plenty of M (per-line limit tests),
  // two L (stock tests), no XL stock (disabled option).
  await product({
    slug: `${SLUG_PREFIX}direct-shirt`,
    name: 'E2E Direct Shirt',
    type: shirt,
    price: 1_500_000,
    ageSeconds: 20_000,
    description: 'A shirt sold by direct size choice.',
    variants: [
      [sizeM, 50],
      [sizeL, 2],
      [await sizeId('XL'), 0],
    ],
  });

  // An active delivery zone so addresses can be saved (the real zones are a client decision).
  await client.query(
    `INSERT INTO delivery_zones (code, name, fee_minor, est_days_min, est_days_max, is_active, is_sample_data, sort_order)
     VALUES ('e2e-lagos', 'E2E Lagos', 250000, 1, 2, true, true, 999)`,
  );

  // Hero: published block with a (mock) video and text.
  const hero = await insertVideo(client, 'hero', '#174c3c');
  await client.query(
    `UPDATE content_blocks SET media_asset_id = $1, is_published = true WHERE block_key = 'home.hero'`,
    [hero.assetId],
  );
}

async function main(): Promise<void> {
  const url = resolveTestUrl();
  const cleanupOnly = process.argv.includes('--cleanup');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    console.log(`Database: ${databaseName(url)}`);
    await client.query('BEGIN');
    await cleanup(client);
    if (!cleanupOnly) await seed(client);
    await client.query('COMMIT');
    console.log(
      cleanupOnly
        ? 'E2E data removed.'
        : `E2E data seeded (${BULK_PRODUCTS + 5} products). Media in ${E2E_MEDIA_DIR}`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

await main();
