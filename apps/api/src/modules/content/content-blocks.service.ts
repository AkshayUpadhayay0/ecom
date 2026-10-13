import type { ContentBlockDto, ContentBlockSummaryDto, PaginationQuery } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { MediaAssetsService } from '../media/media-assets.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toContentBlockDto, toContentBlockSummaryDto } from './content-blocks.dto.js';
import type { ContentBlocksRepository } from './content-blocks.repository.js';

const ENTITY = 'content_block';

/**
 * Content blocks (hero, policies, footer). Admin can publish/unpublish and replace the hero
 * media; static copy (English/Pidgin) is developer-managed, so there is no text editing here.
 * Hidden pages are NOT content blocks and have no admin endpoints.
 */
export interface ContentBlocksService {
  list(query: PaginationQuery): Promise<Page<ContentBlockSummaryDto>>;
  get(key: string): Promise<ContentBlockDto>;
  setPublished(actor: AuditActor, key: string, isPublished: boolean): Promise<ContentBlockDto>;
  /** Hero video: an existing ready, public video asset, or null to clear. */
  setMedia(actor: AuditActor, key: string, mediaAssetId: string | null): Promise<ContentBlockDto>;
}

export interface ContentBlocksServiceDeps {
  db: Database;
  repository: ContentBlocksRepository;
  media: MediaAssetsService;
  settings: SettingsService;
}

export function createContentBlocksService(deps: ContentBlocksServiceDeps): ContentBlocksService {
  const { db, repository, settings } = deps;

  async function load(executor: Database, key: string, lock = false): Promise<ContentBlockDto> {
    const row = await repository.findByKey(executor, key, lock);
    if (!row) throw notFoundError('Content block');
    const translations = await repository.translationsFor(executor, [row.id]);
    return toContentBlockDto(row, translations.get(row.id) ?? []);
  }

  /** Locks the block, applies `change`, audits before/after in the same transaction. */
  async function mutate(
    actor: AuditActor,
    key: string,
    action: string,
    change: (trx: Database, block: ContentBlockDto) => Promise<void>,
  ): Promise<ContentBlockDto> {
    return db.transaction().execute(async (trx) => {
      const before = await load(trx, key, true);
      await change(trx, before);
      const after = await load(trx, key);
      await writeAuditLog(trx, {
        adminId: actor.adminId,
        action,
        entityType: ENTITY,
        entityId: key,
        before,
        after,
        ipAddress: actor.ipAddress,
      });
      return after;
    });
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(db, query.order ?? 'asc', page);
      const translations = await repository.translationsFor(
        db,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) => toContentBlockSummaryDto(row, translations.get(row.id) ?? [])),
        meta: toPageMeta(page, total),
      };
    },

    async get(key) {
      return load(db, key);
    },

    async setPublished(actor, key, isPublished) {
      const action = isPublished ? 'content_block.publish' : 'content_block.unpublish';
      return mutate(actor, key, action, async (trx, block) => {
        await repository.touch(trx, block.id, actor.adminId, { isPublished });
      });
    },

    async setMedia(actor, key, mediaAssetId) {
      return mutate(actor, key, 'content_block.media_replace', async (trx, block) => {
        if (mediaAssetId !== null) await deps.media.assertReadyVideo(trx, mediaAssetId);
        await repository.touch(trx, block.id, actor.adminId, { mediaAssetId });
      });
    },
  };
}
