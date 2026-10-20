import {
  CONTENT_TEXT_LANGUAGE,
  type ContentBlockDto,
  type ContentBlockSummaryDto,
  type PaginationQuery,
  type UpdateContentTextRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { MediaAssetsService } from '../media/media-assets.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toContentBlockDto, toContentBlockSummaryDto } from './content-blocks.dto.js';
import type { ContentBlocksRepository } from './content-blocks.repository.js';

const ENTITY = 'content_block';

/** The editor must match the block: video for the hero, text for footer and policies. */
function assertKind(block: ContentBlockDto, kind: ContentBlockDto['kind']): void {
  if (block.kind !== kind) {
    throw new AppError(
      'INVALID_STATE',
      HTTP_STATUS.CONFLICT,
      kind === 'video'
        ? 'This content block holds text, not a video.'
        : 'This content block holds the hero video, not text.',
      { key: block.key, kind: block.kind },
    );
  }
}

/**
 * Content blocks (hero, policies, footer). Every block can be published/unpublished. VIDEO blocks
 * (home.hero) take a ready public video; TEXT blocks (footer, policies) take a plain-text English
 * title and body (20 Oct 2026). Pidgin copy, translations, hidden pages, QR mappings and serial
 * rules are NOT edited here.
 */
export interface ContentBlocksService {
  list(query: PaginationQuery): Promise<Page<ContentBlockSummaryDto>>;
  get(key: string): Promise<ContentBlockDto>;
  setPublished(actor: AuditActor, key: string, isPublished: boolean): Promise<ContentBlockDto>;
  /** Hero video: an existing ready, public video asset, or null to clear. Video blocks only. */
  setMedia(actor: AuditActor, key: string, mediaAssetId: string | null): Promise<ContentBlockDto>;
  /** English plain-text title and body. Text blocks only. */
  setText(actor: AuditActor, key: string, text: UpdateContentTextRequest): Promise<ContentBlockDto>;
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
        assertKind(block, 'video');
        if (mediaAssetId !== null) await deps.media.assertReadyVideo(trx, mediaAssetId);
        await repository.touch(trx, block.id, actor.adminId, { mediaAssetId });
        // Replaced hero media is kept (retired) unless something else still uses it.
        if (block.mediaAssetId !== null && block.mediaAssetId !== mediaAssetId) {
          await deps.media.retireUnreferenced(trx, actor, [block.mediaAssetId]);
        }
      });
    },

    async setText(actor, key, text) {
      return mutate(actor, key, 'content_block.text_update', async (trx, block) => {
        assertKind(block, 'text');
        await repository.upsertText(trx, block.id, CONTENT_TEXT_LANGUAGE, text);
        await repository.touch(trx, block.id, actor.adminId, {});
      });
    },
  };
}
