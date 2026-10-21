/**
 * Resets a TEXT content block (footer.about, policy.*) to its seeded default through the normal
 * service path, so an admin_audit_logs row ('content_block.text_reset') is written in the name of
 * the given admin. Default = English title / body empty ("Pending client content", migration 0013)
 * and published (the column default). No copy is written.
 *
 *   pnpm content:reset footer.about --as akshay@dev.com
 */
import { pino } from 'pino';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/database.js';
import { AppError } from '../src/lib/errors.js';
import { createContentBlocksRepository } from '../src/modules/content/content-blocks.repository.js';
import { createContentBlocksService } from '../src/modules/content/content-blocks.service.js';
import { createMediaAssetsRepository } from '../src/modules/media/media-assets.repository.js';
import { createMediaAssetsService } from '../src/modules/media/media-assets.service.js';
import { createSettingsRepository } from '../src/modules/settings/settings.repository.js';
import { createSettingsService } from '../src/modules/settings/settings.service.js';

function usage(): never {
  console.error('Usage: pnpm content:reset <block key> --as <super admin email>');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const key = args[0];
  const asIndex = args.indexOf('--as');
  const email = asIndex >= 0 ? args[asIndex + 1] : undefined;
  if (!key || key.startsWith('--') || !email) usage();

  const env = loadEnv();
  const logger = pino({ level: 'silent' });
  const db = createDatabase({ connectionString: env.DATABASE_URL, maxConnections: 1, logger });
  try {
    const admin = await db
      .selectFrom('admin_users')
      .select(['id', 'role', 'is_active'])
      .where('email', '=', email)
      .executeTakeFirst();
    if (!admin?.is_active) throw new Error(`No active admin with email ${email}.`);
    if (admin.role !== 'super_admin') {
      throw new Error('Resetting content is a super_admin action (same rule as the API route).');
    }
    const service = createContentBlocksService({
      db,
      repository: createContentBlocksRepository(),
      media: createMediaAssetsService(createMediaAssetsRepository()),
      settings: createSettingsService({ db, repository: createSettingsRepository() }),
    });
    const block = await service.resetText({ adminId: admin.id, ipAddress: null }, key);
    console.log(
      `Reset ${block.key}: ${block.pending ? 'Pending client content' : 'has text'}, ` +
        `${block.isPublished ? 'published' : 'unpublished'} (audited as content_block.text_reset).`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  if (err instanceof AppError || err instanceof EnvValidationError || err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
