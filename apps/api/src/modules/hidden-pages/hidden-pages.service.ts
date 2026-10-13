import type { HiddenPageStateDto } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import {
  hashBrowserToken,
  newBrowserToken,
  normalizeSerial,
  type SerialHasher,
} from '../serial-access/serial-hash.js';
import type { SerialsRepository } from '../serial-access/serials.repository.js';
import type { HiddenPageRow, HiddenPagesRepository } from './hidden-pages.repository.js';
import type { AccessOutcome, PageAccessRepository } from './page-access.repository.js';

/** The ONLY failure answer for a serial: unknown, inactive and wrong-page look identical. */
export const GENERIC_SERIAL_FAILURE = 'This serial number cannot unlock this page.';

/** Internal reasons, logged (never returned). */
type RejectReason = 'unusable_input' | 'unknown' | 'inactive' | 'wrong_page';

export interface VisitorContext {
  /** Raw value of the visitor's hidden-page cookie, if any. */
  browserToken: string | undefined;
  customerId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface UnlockResult {
  state: HiddenPageStateDto;
  /** Set when the visitor had no cookie yet; the controller must send it. */
  newBrowserToken: string | undefined;
}

export interface HiddenPagesService {
  /** Unknown/unpublished token -> 404. Otherwise locked state or the content. */
  getState(routeToken: string, visitor: VisitorContext): Promise<HiddenPageStateDto>;
  /**
   * Validates an exact serial (trim only) for this page. GENERAL: only its own page (never an
   * exclusive-only page). EXCLUSIVE: every page. Success stores a grant for this browser (and the
   * customer when signed in). No expiry; serials are never marked used.
   */
  unlock(routeToken: string, serial: string, visitor: VisitorContext): Promise<UnlockResult>;
  /** Called by the rate limiter so blocked attempts are visible in qr_access_events. */
  logRateLimited(routeToken: string, visitor: VisitorContext): Promise<void>;
}

export interface HiddenPagesServiceDeps {
  db: Database;
  pages: HiddenPagesRepository;
  access: PageAccessRepository;
  serials: SerialsRepository;
  hasher: SerialHasher;
  logger: Logger;
}

function unlocked(page: HiddenPageRow): HiddenPageStateDto {
  return { locked: false, page: { title: page.title ?? '', body: page.body ?? '' } };
}

function serialRejected(): AppError {
  return new AppError('SERIAL_NOT_VALID', HTTP_STATUS.FORBIDDEN, GENERIC_SERIAL_FAILURE);
}

export function createHiddenPagesService(deps: HiddenPagesServiceDeps): HiddenPagesService {
  const { db, pages, access } = deps;

  async function log(
    executor: Database,
    page: HiddenPageRow | undefined,
    outcome: AccessOutcome,
    visitor: VisitorContext,
    serialId: string | null = null,
  ): Promise<void> {
    await access.logEvent(executor, {
      pageId: page?.id ?? null,
      outcome,
      serialId,
      ipAddress: visitor.ipAddress,
      userAgent: visitor.userAgent,
    });
  }

  async function findPage(routeToken: string, visitor: VisitorContext): Promise<HiddenPageRow> {
    const page = await pages.findPublishedByRouteToken(db, routeToken);
    if (!page) {
      await log(db, undefined, 'INVALID_TOKEN', visitor);
      throw notFoundError('Page');
    }
    return page;
  }

  async function reject(
    page: HiddenPageRow,
    visitor: VisitorContext,
    reason: RejectReason,
    serialId: string | null,
  ): Promise<never> {
    await log(db, page, 'SERIAL_REJECTED', visitor, serialId);
    // The reason helps support/abuse review; the serial itself is never logged.
    deps.logger.warn(
      { pageSlot: page.slotNumber, reason, serialId },
      'hidden page: serial rejected',
    );
    throw serialRejected();
  }

  return {
    async getState(routeToken, visitor) {
      const page = await findPage(routeToken, visitor);
      const holder = {
        browserTokenHash:
          visitor.browserToken === undefined ? null : hashBrowserToken(visitor.browserToken),
        customerId: visitor.customerId,
      };
      const allowed = await access.hasAccess(db, holder, page.id);
      await log(db, page, allowed ? 'PAGE_SERVED' : 'PAGE_LOCKED', visitor);
      return allowed ? unlocked(page) : { locked: true };
    },

    async unlock(routeToken, serial, visitor) {
      const page = await findPage(routeToken, visitor);
      const normalized = normalizeSerial(serial);
      if (normalized === undefined) return reject(page, visitor, 'unusable_input', null);

      const found = await deps.serials.findByHash(db, deps.hasher.hash(normalized));
      if (!found) return reject(page, visitor, 'unknown', null);
      if (!found.isActive) return reject(page, visitor, 'inactive', found.id);
      if (found.category === 'GENERAL' && found.allowedPageId !== page.id) {
        // Also covers the exclusive-only page: no GENERAL serial can be paired with it (DB rule).
        return reject(page, visitor, 'wrong_page', found.id);
      }

      const browserToken = visitor.browserToken ?? newBrowserToken();
      await db.transaction().execute(async (trx) => {
        await access.grant(trx, {
          serialId: found.id,
          scope: found.category === 'EXCLUSIVE' ? 'ALL' : 'PAGE',
          pageId: found.category === 'EXCLUSIVE' ? null : page.id,
          browserTokenHash: hashBrowserToken(browserToken),
          customerId: visitor.customerId,
        });
        await log(trx, page, 'SERIAL_ACCEPTED', visitor, found.id);
      });
      return {
        state: unlocked(page),
        newBrowserToken: visitor.browserToken === undefined ? browserToken : undefined,
      };
    },

    async logRateLimited(routeToken, visitor) {
      const page = await pages.findPublishedByRouteToken(db, routeToken);
      await log(db, page, 'RATE_LIMITED', visitor);
    },
  };
}
