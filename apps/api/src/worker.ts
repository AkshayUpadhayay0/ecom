/**
 * Background worker (DB queues with FOR UPDATE SKIP LOCKED, no Redis). Each loop:
 *  1. releases stock held by unpaid orders whose reservation expired;
 *  2. reconciles unresolved payment attempts with the provider (missed webhooks);
 *  3. sends due emails from email_outbox (retries with backoff);
 *  4. processes uploaded media.
 *
 *   pnpm worker        (alias: pnpm worker:media)
 *
 * Several workers may run at once; each job row is claimed by exactly one.
 */
import { tmpdir } from 'node:os';
import type { MediaKind } from '@urban-ibile/shared';
import { API_BASE_PATH } from './app.js';
import { EnvValidationError, loadEnv, type Env } from './config/env.js';
import { createDatabase } from './db/database.js';
import { createLogger } from './lib/logger.js';
import { releaseExpiredReservations } from './modules/checkout/reservation-expiry.js';
import { createReservationsRepository } from './modules/inventory/reservations.repository.js';
import { createMediaRepository } from './modules/media/media.repository.js';
import {
  FFMPEG_INSTALL_HELP,
  createFfmpegRunner,
} from './modules/media/processing/ffmpeg-runner.js';
import { createImageProcessor } from './modules/media/processing/image-processor.js';
import { createMediaProcessor } from './modules/media/processing/media-processor.js';
import { createStorage } from './modules/media/storage/create-storage.js';
import { createEmailOutboxRepository } from './modules/notifications/email-outbox.repository.js';
import { createEmailOutboxService } from './modules/notifications/email-outbox.service.js';
import { createEmailSender } from './modules/notifications/email-sender.js';
import { createOrdersRepository } from './modules/orders/orders.repository.js';
import { buildPaymentConfirmation } from './modules/payments/payments.module.js';
import { createPaymentsRepository } from './modules/payments/payments.repository.js';
import { createPaymentProvider } from './modules/payments/provider/create-provider.js';
import { reconcilePayments } from './modules/payments/reconciliation.js';
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
const settings = createSettingsService({ db, repository: createSettingsRepository() });
const expiryDeps = {
  db,
  orders: createOrdersRepository(),
  reservations: createReservationsRepository(),
  settings,
  logger,
};
const paymentProvider = createPaymentProvider(env, API_BASE_PATH);
const reconciliationDeps = {
  db,
  payments: createPaymentsRepository(),
  confirmation: buildPaymentConfirmation({ db, logger, provider: paymentProvider }),
  settings,
  logger,
};
const emailSender = createEmailSender(env, logger);
const outbox = createEmailOutboxService({
  db,
  repository: createEmailOutboxRepository(),
  sender: emailSender,
  settings,
  from: env.EMAIL_FROM,
  batchSize: env.EMAIL_OUTBOX_BATCH,
  logger,
});
const ffmpeg = createFfmpegRunner({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH });
const processor = createMediaProcessor({
  db,
  repository: createMediaRepository(),
  storage: createStorage(env, API_BASE_PATH),
  settings,
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
  logger.info({ signal }, 'worker stopping after the current job');
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

/** One job type failing never stops the others. */
async function step(name: string, job: () => Promise<unknown>): Promise<void> {
  try {
    await job();
  } catch (err) {
    logger.error({ err }, `${name} error`);
  }
}

async function main(): Promise<void> {
  const check = await ffmpeg.check();
  let kinds: MediaKind[] = ['video', 'image'];
  if (check.ok) {
    logger.info({ ffmpeg: check.version, storage: env.MEDIA_STORAGE_DRIVER }, 'worker started');
  } else {
    // Images still work (sharp); videos wait in the queue until ffmpeg is installed.
    kinds = ['image'];
    process.stderr.write(`\n${FFMPEG_INSTALL_HELP}\n\n`);
    logger.error({ error: check.error }, 'ffmpeg unavailable: processing images only');
  }
  logger.info(
    { payments: paymentProvider.name, email: env.EMAIL_PROVIDER, mockedEmail: emailSender.mocked },
    'payments + email outbox enabled',
  );

  const pollMs = Math.min(env.MEDIA_WORKER_POLL_MS, env.EMAIL_OUTBOX_POLL_MS);
  while (isRunning()) {
    await step('reservation expiry', () =>
      releaseExpiredReservations(expiryDeps, env.RESERVATION_SWEEP_BATCH),
    );
    await step('payment reconciliation', () => reconcilePayments(reconciliationDeps));
    await step('email outbox', () => outbox.processBatch());
    await step('media processing', () => processor.drain(kinds));
    if (isRunning()) await sleep(pollMs);
  }
  await db.destroy();
  logger.info('worker stopped');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker crashed');
  process.exit(1);
});
