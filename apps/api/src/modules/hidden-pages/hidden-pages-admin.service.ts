import type {
  AdminHiddenPageDto,
  PaginationQuery,
  UpdateHiddenPageContentRequest,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { notFoundError } from '../../lib/errors.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toAdminHiddenPageDto } from './hidden-pages.dto.js';
import type { HiddenPagesRepository } from './hidden-pages.repository.js';

export interface HiddenPagesAdminService {
  list(query: PaginationQuery): Promise<Page<AdminHiddenPageDto>>;
  get(id: string): Promise<AdminHiddenPageDto>;
  /**
   * Replaces the page's title and body (default language). The slug and route token never
   * change, so printed QR codes keep working.
   */
  updateContent(
    actor: AuditActor,
    id: string,
    input: UpdateHiddenPageContentRequest,
  ): Promise<AdminHiddenPageDto>;
}

export interface HiddenPagesAdminServiceDeps {
  db: Database;
  repository: HiddenPagesRepository;
  settings: SettingsService;
  /** Base URL of the customer website (env PUBLIC_WEB_URL; final domain pending). */
  publicWebUrl: string;
}

export function createHiddenPagesAdminService(
  deps: HiddenPagesAdminServiceDeps,
): HiddenPagesAdminService {
  const { db, repository, publicWebUrl } = deps;

  async function load(executor: Database, id: string, lock = false): Promise<AdminHiddenPageDto> {
    const row = await repository.findById(executor, id, lock);
    if (!row) throw notFoundError('Hidden page');
    return toAdminHiddenPageDto(row, publicWebUrl);
  }

  return {
    async list(query) {
      const page = toPageRequest(query, await deps.settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.list(db, page);
      return {
        items: rows.map((row) => toAdminHiddenPageDto(row, publicWebUrl)),
        meta: toPageMeta(page, total),
      };
    },

    async get(id) {
      return load(db, id);
    },

    async updateContent(actor, id, input) {
      return db.transaction().execute(async (trx) => {
        const before = await load(trx, id, true);
        await repository.updateContent(trx, id, input);
        const after = await load(trx, id);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'hidden_page.content_update',
          entityType: 'hidden_page',
          entityId: id,
          before: { title: before.title, body: before.body },
          after: { title: after.title, body: after.body },
          ipAddress: actor.ipAddress,
        });
        return after;
      });
    },
  };
}
