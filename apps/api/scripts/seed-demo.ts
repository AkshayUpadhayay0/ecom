/**
 * Demo data for local development and client demos. Everything it creates is marked as demo and
 * is removed again by the remove command. Refused in production and on any database other than
 * the local development database (see src/modules/demo/demo-data.ts).
 *
 *   pnpm seed:demo              create / refresh the demo data
 *   pnpm seed:demo --no-video   skip the generated videos and the demo hero video
 *   pnpm seed:demo:remove       remove it
 *
 * What it creates:
 *  - one active delivery zone, "Sample zone (temporary)" with a SAMPLE fee (PENDING CLIENT
 *    DECISION: real areas, fees and timings);
 *  - 24 products "Demo outfit 01" ... with sizes and stock, created through the normal services
 *    (admin audit log included, attributed to your first admin account): videos, photo-only, one
 *    without media, one with the male top Blueprint profile, one sold out, one low on stock;
 *  - placeholder media: ffmpeg test-pattern videos and generated gradient photos, uploaded through
 *    the real media pipeline (presigned upload -> complete -> the worker transcodes them);
 *  - a demo hero video (only when the home hero has no video yet).
 *
 * For videos it needs FFmpeg, and `pnpm worker` running so the clips get processed (the API only
 *
 * Removal: products are soft-deleted (or archived when open business blocks the delete), media is
 * detached, retired and purged, the demo hero is cleared, the demo zone is deleted (or
 * deactivated when addresses use it). Only records carrying the demo markers are touched.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import sharp from 'sharp';
import { API_BASE_PATH } from '../src/app.js';
import { EnvValidationError, loadEnv, type Env } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/db/database.js';
import { AppError } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import type { AuditActor } from '../src/modules/audit/audit-actor.js';
import { createMeasurementProfilesRepository } from '../src/modules/blueprint/measurement-profiles.repository.js';
import { createClothingTypesRepository } from '../src/modules/catalog/clothing-types.repository.js';
import { createPendingMediaRepository } from '../src/modules/catalog/pending-media.repository.js';
import { createProductsRepository } from '../src/modules/catalog/products.repository.js';
import { createProductsService } from '../src/modules/catalog/products.service.js';
import { createSizesRepository } from '../src/modules/catalog/sizes.repository.js';
import { createContentBlocksRepository } from '../src/modules/content/content-blocks.repository.js';
import { createContentBlocksService } from '../src/modules/content/content-blocks.service.js';
import {
  DEMO,
  DEMO_VIDEO_PATTERNS,
  assertDemoSeedAllowed,
  planDemoProducts,
  type DemoProduct,
} from '../src/modules/demo/demo-data.js';
import { createInventoryService } from '../src/modules/inventory/inventory.service.js';
import { createVariantsRepository } from '../src/modules/inventory/variants.repository.js';
import { createMediaAssetsRepository } from '../src/modules/media/media-assets.repository.js';
import { createMediaAssetsService } from '../src/modules/media/media-assets.service.js';
import { createMediaUsageRepository } from '../src/modules/media/media-usage.repository.js';
import { createMediaRepository } from '../src/modules/media/media.repository.js';
import { createMediaService } from '../src/modules/media/media.service.js';
import {
  FFMPEG_INSTALL_HELP,
  createFfmpegRunner,
} from '../src/modules/media/processing/ffmpeg-runner.js';
import { createStorage, isLocalStorage } from '../src/modules/media/storage/create-storage.js';
import type { StorageProvider } from '../src/modules/media/storage/storage-provider.js';
import { createSettingsRepository } from '../src/modules/settings/settings.repository.js';
import { createSettingsService } from '../src/modules/settings/settings.service.js';

const FOREIGN_KEY_VIOLATION = '23503';
const HERO_KEY = 'home.hero';
const MALE_TOP_PROFILE = 'male_top';
const VIDEO_SECONDS = 4;
const HERO_SECONDS = 6;
const PROCESSING_WAIT_MS = 180_000;
const POLL_MS = 2_000;
const SIZES_PER_PRODUCT = 5;
/** Soft brand-adjacent palette for the generated photos (no text, no logos). */
const PHOTO_COLORS = ['#174C3C', '#C95D43', '#F2B544', '#F5262D', '#171717', '#5C5B57'] as const;

/** SAMPLE / TEMPORARY: not a real delivery area or fee. */
export const DEMO_ZONE = {
  code: 'demo-sample-zone',
  name: 'Sample zone (temporary)',
  /** Clearly a placeholder amount (NGN 1,500.00 in minor units). */
  feeMinor: 150_000,
  estDaysMin: 2,
  estDaysMax: 4,
  sortOrder: 900,
} as const;

function say(line: string): void {
  console.log(line);
}

// ---------------------------------------------------------------- composition

interface Services {
  env: Env;
  db: Database;
  actor: AuditActor;
  products: ReturnType<typeof createProductsService>;
  inventory: ReturnType<typeof createInventoryService>;
  media: ReturnType<typeof createMediaService>;
  content: ReturnType<typeof createContentBlocksService>;
  storage: StorageProvider;
}

async function firstAdmin(db: Database): Promise<AuditActor> {
  const admin = await db
    .selectFrom('admin_users')
    .select('id')
    .where('is_active', '=', true)
    .orderBy(sql`role = 'super_admin'`, 'desc')
    .orderBy('created_at')
    .executeTakeFirst();
  if (!admin) throw new Error('No admin account exists yet. Create one first: pnpm admin:create');
  return { adminId: admin.id, ipAddress: null };
}

async function compose(env: Env, db: Database): Promise<Services> {
  const logger = createLogger(env);
  const storage = createStorage(env, API_BASE_PATH);
  const settings = createSettingsService({ db, repository: createSettingsRepository() });
  const assets = createMediaAssetsService(createMediaAssetsRepository());
  const productsRepository = createProductsRepository();
  return {
    env,
    db,
    actor: await firstAdmin(db),
    storage,
    products: createProductsService({
      db,
      repository: productsRepository,
      clothingTypes: createClothingTypesRepository(),
      measurementProfiles: createMeasurementProfilesRepository(),
      media: assets,
      pending: createPendingMediaRepository(),
      settings,
    }),
    inventory: createInventoryService({
      db,
      repository: createVariantsRepository(),
      products: productsRepository,
      sizes: createSizesRepository(),
      settings,
    }),
    media: createMediaService({
      db,
      repository: createMediaRepository(),
      assets: createMediaAssetsRepository(),
      usage: createMediaUsageRepository(),
      storage,
      settings,
      logger,
    }),
    content: createContentBlocksService({
      db,
      repository: createContentBlocksRepository(),
      media: assets,
      settings,
    }),
  };
}

// ---------------------------------------------------------------- media generation

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-400)}`));
    });
  });
}

async function makeVideo(
  env: Env,
  file: string,
  pattern: string,
  size: string,
  seconds: number,
): Promise<void> {
  await run(env.FFMPEG_PATH, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${pattern}=size=${size}:rate=24`,
    '-t',
    String(seconds),
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-an',
    '-movflags',
    '+faststart',
    file,
  ]);
}

async function makePhoto(file: string, seed: number): Promise<void> {
  const a = PHOTO_COLORS[seed % PHOTO_COLORS.length] ?? '#174C3C';
  const b = PHOTO_COLORS[(seed + 2) % PHOTO_COLORS.length] ?? '#C95D43';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="1500" fill="url(#g)"/><circle cx="${300 + (seed % 5) * 120}" cy="${500 + (seed % 3) * 200}" r="260" fill="#FFFCEB" fill-opacity="0.18"/></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(file);
}

/** Presigned upload -> PUT the bytes -> complete: exactly what the admin panel does. */
async function uploadAsset(
  s: Services,
  file: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const bytes = await readFile(file);
  const created = await s.media.createUpload(
    s.actor,
    { fileName, mimeType, sizeBytes: bytes.length, visibility: 'public', isTemporary: true },
    'library',
  );
  if (isLocalStorage(s.storage)) {
    // MOCK local storage: the signed URL is only valid for the process that signed it, so the
    // bytes go straight into the same storage object (the API only has to serve the files).
    const token = s.storage.verifyToken(created.upload.url.split('/').pop() ?? '');
    if (!token) throw new Error(`Could not prepare the upload of ${fileName}.`);
    await s.storage.receiveUpload(token, mimeType, Readable.from(bytes));
  } else {
    const {
      'content-length': _length,
      'Content-Length': _Length,
      ...headers
    } = created.upload.headers;
    const response = await fetch(created.upload.url, { method: 'PUT', headers, body: bytes });
    if (!response.ok) throw new Error(`Upload of ${fileName} failed (${response.status}).`);
  }
  await s.media.completeUpload(s.actor, created.asset.id, 'library');
  return created.asset.id;
}

// ---------------------------------------------------------------- create

async function lookup(db: Database) {
  const types = new Map(
    (await db.selectFrom('clothing_types').select(['id', 'slug']).execute()).map((r) => [
      r.slug,
      r.id,
    ]),
  );
  const sizes = await db
    .selectFrom('sizes')
    .select(['id', 'code'])
    .where('is_active', '=', true)
    .orderBy('sort_order')
    .execute();
  const profile = await db
    .selectFrom('measurement_profiles')
    .select('id')
    .where('code', '=', MALE_TOP_PROFILE)
    .executeTakeFirst();
  if (types.size === 0 || sizes.length === 0)
    throw new Error(
      'Run pnpm db:migrate and pnpm db:seed first (sizes and clothing types are missing).',
    );
  return { types, sizes, profileId: profile?.id ?? null };
}

async function createProduct(
  s: Services,
  plan: DemoProduct,
  ref: Awaited<ReturnType<typeof lookup>>,
  media: { videoAssetId?: string; imageAssetIds?: string[] },
): Promise<void> {
  const typeId = ref.types.get(plan.typeSlug) ?? [...ref.types.values()][0];
  if (!typeId) throw new Error('No clothing type available.');
  const product = await s.products.create(s.actor, {
    name: plan.name,
    slug: plan.slug,
    clothingTypeId: typeId,
    description: DEMO.description,
    priceMinor: plan.priceMinor,
    measurementProfileId: plan.blueprint ? ref.profileId : null,
    searchKeywords: DEMO.keyword,
    displayOrder: plan.number,
    status: 'draft',
    ...(media.videoAssetId ? { videoAssetId: media.videoAssetId } : {}),
    ...(media.imageAssetIds ? { imageAssetIds: media.imageAssetIds } : {}),
  });
  const sizes = ref.sizes.slice(0, Math.min(SIZES_PER_PRODUCT, plan.stock.length));
  for (const [index, size] of sizes.entries()) {
    const variant = await s.inventory.createVariant(s.actor, product.id, {
      sizeId: size.id,
      sku: `${DEMO.skuPrefix}${String(plan.number).padStart(2, '0')}-${size.code}`.toUpperCase(),
      isActive: true,
    });
    const units = plan.stock[index] ?? 0;
    if (units > 0) {
      await s.inventory.adjustStock(s.actor, variant.id, {
        type: 'initial',
        newOnHand: units,
        note: 'Demo seed',
      });
    }
  }
  await s.products.changeStatus(s.actor, product.id, 'active');
}

async function seedCatalog(s: Services, withVideo: boolean): Promise<void> {
  const ref = await lookup(s.db);
  const work = await mkdtemp(join(tmpdir(), 'ui-demo-'));
  try {
    const existing = new Set(
      (
        await s.db
          .selectFrom('products')
          .select('slug')
          .where('slug', 'like', `${DEMO.slugPrefix}%`)
          .where('deleted_at', 'is', null)
          .execute()
      ).map((r) => r.slug),
    );
    const todo = planDemoProducts().filter((p) => !existing.has(p.slug));
    say(`Demo products: ${existing.size} already exist, creating ${todo.length}.`);

    // Placeholder videos: one clip per test pattern (reused by name), uploaded per product.
    for (const plan of todo) {
      const media: { videoAssetId?: string; imageAssetIds?: string[] } = {};
      if (plan.media === 'video' && withVideo) {
        const pattern = DEMO_VIDEO_PATTERNS[plan.number % DEMO_VIDEO_PATTERNS.length] ?? 'testsrc2';
        const file = join(work, `video-${plan.number}.mp4`);
        await makeVideo(s.env, file, pattern, '720x1280', VIDEO_SECONDS);
        media.videoAssetId = await uploadAsset(
          s,
          file,
          `${DEMO.filePrefix}video-${String(plan.number).padStart(2, '0')}.mp4`,
          'video/mp4',
        );
      }
      if (plan.media === 'photos' || (plan.media === 'video' && !withVideo)) {
        const count = plan.media === 'photos' ? plan.photoCount : 1;
        media.imageAssetIds = [];
        for (let k = 0; k < count; k += 1) {
          const file = join(work, `photo-${plan.number}-${k}.jpg`);
          await makePhoto(file, plan.number + k);
          media.imageAssetIds.push(
            await uploadAsset(
              s,
              file,
              `${DEMO.filePrefix}photo-${String(plan.number).padStart(2, '0')}-${k + 1}.jpg`,
              'image/jpeg',
            ),
          );
        }
      }
      await createProduct(s, plan, ref, media);
      say(`  created ${plan.name} (${plan.media}${plan.blueprint ? ', Blueprint male top' : ''})`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function waitUntilReady(db: Database, assetId: string): Promise<boolean> {
  const deadline = Date.now() + PROCESSING_WAIT_MS;
  while (Date.now() < deadline) {
    const row = await db
      .selectFrom('media_assets')
      .select('processing_status')
      .where('id', '=', assetId)
      .executeTakeFirstOrThrow();
    if (row.processing_status === 'ready') return true;
    if (row.processing_status === 'failed') return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

async function seedHero(s: Services): Promise<void> {
  const block = await s.db
    .selectFrom('content_blocks')
    .select('media_asset_id')
    .where('block_key', '=', HERO_KEY)
    .executeTakeFirst();
  if (!block) {
    say('No home.hero content block: skipping the demo hero.');
    return;
  }
  if (block.media_asset_id) {
    say('The home hero already has a video: left untouched.');
    return;
  }

  let asset = await s.db
    .selectFrom('media_assets')
    .select(['id', 'processing_status'])
    .where('original_filename', 'like', `${DEMO.filePrefix}hero%`)
    .where('retired_at', 'is', null)
    .executeTakeFirst();
  if (!asset) {
    const work = await mkdtemp(join(tmpdir(), 'ui-demo-hero-'));
    try {
      const file = join(work, 'hero.mp4');
      await makeVideo(s.env, file, 'smptehdbars', '1920x1080', HERO_SECONDS);
      const id = await uploadAsset(s, file, `${DEMO.filePrefix}hero.mp4`, 'video/mp4');
      asset = { id, processing_status: 'uploaded' };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  say('Waiting for the worker to process the hero video (is pnpm worker running?) ...');
  if (!(await waitUntilReady(s.db, asset.id))) {
    say(
      'The hero video is not ready yet. Start pnpm worker, then run pnpm seed:demo again to attach it.',
    );
    return;
  }
  await s.content.setMedia(s.actor, HERO_KEY, asset.id);
  await s.content.setPublished(s.actor, HERO_KEY, true);
  say('Demo hero video attached and published.');
}

async function createZone(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO delivery_zones (code, name, fee_minor, est_days_min, est_days_max, is_active, is_sample_data, sort_order)
     VALUES ($1, $2, $3, $4, $5, true, true, $6)
     ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, fee_minor = EXCLUDED.fee_minor, est_days_min = EXCLUDED.est_days_min,
           est_days_max = EXCLUDED.est_days_max, is_active = true, is_sample_data = true`,
    [
      DEMO_ZONE.code,
      DEMO_ZONE.name,
      DEMO_ZONE.feeMinor,
      DEMO_ZONE.estDaysMin,
      DEMO_ZONE.estDaysMax,
      DEMO_ZONE.sortOrder,
    ],
  );
  say(
    `Demo zone ready: "${DEMO_ZONE.name}" (SAMPLE fee ${DEMO_ZONE.feeMinor / 100} NGN, not a real price).`,
  );
}

// ---------------------------------------------------------------- remove

async function removeZone(client: pg.Client): Promise<void> {
  try {
    const result = await client.query('DELETE FROM delivery_zones WHERE code = $1', [
      DEMO_ZONE.code,
    ]);
    say(result.rowCount ? 'Demo zone removed.' : 'No demo zone to remove.');
  } catch (err) {
    if ((err as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw err;
    await client.query('UPDATE delivery_zones SET is_active = false WHERE code = $1', [
      DEMO_ZONE.code,
    ]);
    say('Demo zone is used by saved addresses or orders: deactivated instead of deleted.');
  }
}

async function removeCatalog(s: Services): Promise<void> {
  const demoAssets = await s.db
    .selectFrom('media_assets')
    .select(['id', 'processing_status'])
    .where('original_filename', 'like', `${DEMO.filePrefix}%`)
    .where('is_temporary', '=', true)
    .execute();
  const demoAssetIds = new Set(demoAssets.map((a) => a.id));

  const hero = await s.db
    .selectFrom('content_blocks')
    .select('media_asset_id')
    .where('block_key', '=', HERO_KEY)
    .executeTakeFirst();
  if (hero?.media_asset_id && demoAssetIds.has(hero.media_asset_id)) {
    await s.content.setMedia(s.actor, HERO_KEY, null);
    say('Demo hero video cleared.');
  }

  const products = await s.db
    .selectFrom('products')
    .select(['id', 'slug'])
    .where('slug', 'like', `${DEMO.slugPrefix}%`)
    .where('search_keywords', 'like', `%${DEMO.keyword}%`)
    .where('deleted_at', 'is', null)
    .execute();
  let deleted = 0;
  let archived = 0;
  for (const product of products) {
    try {
      await s.products.delete(s.actor, product.id);
      deleted += 1;
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'PRODUCT_DELETE_BLOCKED') throw err;
      await s.products.changeStatus(s.actor, product.id, 'archived');
      archived += 1;
    }
  }
  say(
    `Demo products: ${deleted} deleted, ${archived} archived (open orders or returns still use them).`,
  );

  let retired = 0;
  let stillBusy = 0;
  for (const asset of demoAssets) {
    try {
      await s.media.delete(s.actor, asset.id, 'library');
      retired += 1;
      await s.media.purge(s.actor, asset.id).catch(() => undefined); // files removed when nothing references them
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      stillBusy += 1;
    }
  }
  say(
    `Demo media: ${retired} removed${stillBusy ? `, ${stillBusy} left (still processing: run pnpm worker, then remove again)` : ''}.`,
  );
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const env = loadEnv();
  assertDemoSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    allowedDatabase: process.env.DEMO_SEED_DATABASE,
  });
  const removing = process.argv.includes('--remove');
  const withVideo = !process.argv.includes('--no-video');

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  const logger = createLogger(env);
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: 2,
    logger,
    applicationName: 'urban-ibile-demo-seed',
  });
  await client.connect();
  try {
    const services = await compose(env, db);
    if (removing) {
      await removeCatalog(services);
      await removeZone(client);
      return;
    }
    if (withVideo) {
      const ffmpeg = await createFfmpegRunner({
        ffmpegPath: env.FFMPEG_PATH,
        ffprobePath: env.FFPROBE_PATH,
      }).check();
      if (!ffmpeg.ok) {
        process.stderr.write(`\n${FFMPEG_INSTALL_HELP}\n\nOr run: pnpm seed:demo --no-video\n`);
        throw new Error('FFmpeg is needed for the placeholder videos.');
      }
    }
    await createZone(client);
    await seedCatalog(services, withVideo);
    if (withVideo) await seedHero(services);
    say('Done. Remove it all again with: pnpm seed:demo:remove');
  } finally {
    await client.end();
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  if (err instanceof EnvValidationError) process.stderr.write(`${err.message}\n`);
  else console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
