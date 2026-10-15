/**
 * Background worker (DB queues with FOR UPDATE SKIP LOCKED, no Redis):
 *  - processes uploaded media;
 *  - releases stock held by unpaid orders whose reservation expired.
 *
 *   pnpm worker        (alias: pnpm worker:media)
 *
 * Several workers may run at once; each asset / expired order is claimed by exactly one.
 */
import { tmpdir } from 'node:os';
import type { MediaKind } from '@urban-ibile/shared';
import { API_BASE_PATH } from './app.js';
import { EnvValidationError, loadEnv, type Env } from './config/env.js';
import { createDatabase } from './db/database.js';
import { createLogger } from './lib/logger.js';
import { createMediaRepository } from './modules/media/media.repository.js';
import {
  FFMPEG_INSTALL_HELP,
  createFfmpegRunner,
} from './modules/media/processing/ffmpeg-runner.js';
import { createImageProcessor } from './modules/media/processing/image-processor.js';
import { createMediaProcessor } from './modules/media/processing/media-processor.js';
import { createStorage } from './modules/media/storage/create-storage.js';
import { releaseExpiredReservations } from './modules/checkout/reservation-expiry.js';
import { createReservationsRepository } from './modules/inventory/reservations.repository.js';
import { createOrdersRepository } from './modules/orders/orders.repository.js';
import { createSettingsRepository } from './modules/settings/settings.repository.js';
import { createSettingsService } from './modules/settings/settings.service.js';

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const env = readEnvOrExit();
const logger = createLogger(env);
const db = createDatabase({
  connectionString: env.DATABASE_URL,
  maxConnections: env.DB_POOL_MAX,
  logger,
  applicationName: 'urban-ibile-worker',
});
const expiryDeps = {
  db,
  orders: createOrdersRepository(),
  reservations: createReservationsRepository(),
  logger,
};
const ffmpeg = createFfmpegRunner({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH });
const processor = createMediaProcessor({
  db,
  repository: createMediaRepository(),
  storage: createStorage(env, API_BASE_PATH),
  settings: createSettingsService({ db, repository: createSettingsRepository() }),
  ffmpeg,
  images: createImageProcessor(),
  logger,
  encode: { preset: env.FFMPEG_X264_PRESET, crf: env.FFMPEG_X264_CRF },
  tempDir: env.MEDIA_TEMP_DIR ?? tmpdir(),
});

let running = true;
/** Read through a function: `stop` flips the flag from a signal handler. */
const isRunning = (): boolean => running;
let wake: (() => void) | undefined;

function stop(signal: NodeJS.Signals): void {
  if (!running) return;
  running = false;
  logger.info({ signal }, 'media worker stopping after the current job');
  wake?.();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main(): Promise<void> {
  const check = await ffmpeg.check();
  let kinds: MediaKind[] = ['video', 'image'];
  if (check.ok) {
    logger.info(
      { ffmpeg: check.version, storage: env.MEDIA_STORAGE_DRIVER },
      'media worker started',
    );
  } else {
    // Images still work (sharp); videos wait in the queue until ffmpeg is installed.
    kinds = ['image'];
    process.stderr.write(`\n${FFMPEG_INSTALL_HELP}\n\n`);
    logger.error({ error: check.error }, 'ffmpeg unavailable: processing images only');
  }

  while (isRunning()) {
    try {
      await releaseExpiredReservations(expiryDeps, env.RESERVATION_SWEEP_BATCH);
    } catch (err) {
      logger.error({ err }, 'reservation expiry error');
    }
    try {
      await processor.drain(kinds);
    } catch (err) {
      logger.error({ err }, 'media worker loop error');
    }
    if (isRunning()) await sleep(env.MEDIA_WORKER_POLL_MS);
  }
  await db.destroy();
  logger.info('media worker stopped');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'media worker crashed');
  process.exit(1);
});
