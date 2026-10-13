import {
  SERIAL_CATEGORIES,
  type PaginationQuery,
  type SerialBatchDto,
  type SerialCategory,
  type SerialDto,
  type SerialImportQuery,
  type SerialImportResultDto,
  type SerialImportRowIssueDto,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import type {
  HiddenPagesRepository,
  PageSlotRow,
} from '../hidden-pages/hidden-pages.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import { parseCsv } from './csv.js';
import { normalizeSerial, serialHint, type SerialHasher } from './serial-hash.js';
import type { NewSerial, SerialRow, SerialsRepository } from './serials.repository.js';

/** Upper bound on data rows per upload (technical guard). */
export const SERIAL_IMPORT_MAX_ROWS = 20_000;
const EXPECTED_HEADER = ['serial', 'category', 'pageslot'];

export interface SerialsService {
  /**
   * CSV `serial,category,pageSlot` (header required). Valid rows are imported in ONE
   * transaction; duplicates and invalid rows are reported per line (never with the serial).
   */
  importCsv(
    actor: AuditActor,
    csv: string,
    query: SerialImportQuery,
  ): Promise<SerialImportResultDto>;
  /** Looks the serial up by its hash; the plaintext is never stored or logged. */
  deactivate(actor: AuditActor, serial: string): Promise<SerialDto>;
  listBatches(query: PaginationQuery): Promise<Page<SerialBatchDto>>;
}

export interface SerialsServiceDeps {
  db: Database;
  repository: SerialsRepository;
  pages: HiddenPagesRepository;
  hasher: SerialHasher;
  settings: SettingsService;
}

interface ParsedRow {
  line: number;
  hash: string;
  hint: string;
  category: SerialCategory;
  allowedPageId: string | null;
}

function isCategory(value: string): value is SerialCategory {
  return (SERIAL_CATEGORIES as readonly string[]).includes(value);
}

function emptyCounts(): Record<SerialCategory, number> {
  return { GENERAL: 0, EXCLUSIVE: 0 };
}

/** Validates one CSV row. Returns the issue text, or the parsed row. */
function parseRow(
  line: number,
  cells: string[],
  hasher: SerialHasher,
  slots: Map<number, PageSlotRow>,
): ParsedRow | SerialImportRowIssueDto {
  const [rawSerial = '', rawCategory = '', rawSlot = ''] = cells;
  const serial = normalizeSerial(rawSerial);
  if (serial === undefined) return { line, hint: null, reason: 'Serial is empty or too long.' };
  const hint = serialHint(serial);
  if (cells.length > EXPECTED_HEADER.length) {
    return { line, hint, reason: 'Too many columns.' };
  }
  const category = rawCategory.trim().toUpperCase();
  if (!isCategory(category)) {
    return { line, hint, reason: 'Category must be GENERAL or EXCLUSIVE.' };
  }
  const slotText = rawSlot.trim();
  if (category === 'EXCLUSIVE') {
    if (slotText !== '') {
      return { line, hint, reason: 'EXCLUSIVE serials unlock every page; leave pageSlot empty.' };
    }
    return { line, hash: hasher.hash(serial), hint, category, allowedPageId: null };
  }
  const slot = /^\d+$/.test(slotText) ? slots.get(Number(slotText)) : undefined;
  if (!slot) return { line, hint, reason: 'GENERAL serials need an existing pageSlot.' };
  if (slot.exclusiveOnly) {
    return {
      line,
      hint,
      reason: `Page ${slot.slotNumber} is exclusive-only; GENERAL serials cannot open it.`,
    };
  }
  return { line, hash: hasher.hash(serial), hint, category, allowedPageId: slot.id };
}

function toSerialDto(row: SerialRow, isActive = row.isActive): SerialDto {
  return {
    id: row.id,
    hint: row.hint,
    category: row.category,
    allowedPageSlot: row.allowedPageSlot,
    isActive,
  };
}

function genericNotFound(): AppError {
  return new AppError('NOT_FOUND', HTTP_STATUS.NOT_FOUND, 'Serial not found.');
}

export function createSerialsService(deps: SerialsServiceDeps): SerialsService {
  const { db, repository, hasher } = deps;

  return {
    async importCsv(actor, csv, query) {
      const rows = parseCsv(csv);
      const header = rows.shift();
      const headerCells = header?.cells.map((cell) => cell.trim().toLowerCase());
      if (headerCells?.join(',') !== EXPECTED_HEADER.join(',')) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'The CSV must start with the header row: serial,category,pageSlot',
        );
      }
      if (rows.length === 0 || rows.length > SERIAL_IMPORT_MAX_ROWS) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          `The CSV must contain between 1 and ${SERIAL_IMPORT_MAX_ROWS} serial rows.`,
        );
      }

      const slots = new Map(
        (await deps.pages.listSlots(db)).map((slot) => [slot.slotNumber, slot]),
      );
      const invalid: SerialImportRowIssueDto[] = [];
      const duplicates: SerialImportRowIssueDto[] = [];
      const valid: ParsedRow[] = [];
      const seenInFile = new Set<string>();
      for (const row of rows) {
        const parsed = parseRow(row.line, row.cells, hasher, slots);
        if (!('hash' in parsed)) {
          invalid.push(parsed);
        } else if (seenInFile.has(parsed.hash)) {
          duplicates.push({
            line: parsed.line,
            hint: parsed.hint,
            reason: 'Repeated in this file.',
          });
        } else {
          seenInFile.add(parsed.hash);
          valid.push(parsed);
        }
      }

      const existing = await repository.existingHashes(
        db,
        valid.map((row) => row.hash),
      );
      const fresh = valid.filter((row) => {
        if (!existing.has(row.hash)) return true;
        duplicates.push({ line: row.line, hint: row.hint, reason: 'Already imported.' });
        return false;
      });

      const result = (batchId: string | null, imported: ParsedRow[]): SerialImportResultDto => {
        const byCategory = emptyCounts();
        for (const row of imported) byCategory[row.category] += 1;
        return {
          batchId,
          dryRun: query.dryRun,
          totalRows: rows.length,
          imported: imported.length,
          byCategory,
          duplicates: duplicates.sort((a, b) => a.line - b.line),
          invalid,
        };
      };

      if (query.dryRun || fresh.length === 0) return result(null, query.dryRun ? fresh : []);

      return db.transaction().execute(async (trx) => {
        const batchId = await repository.createBatch(trx, {
          adminId: actor.adminId,
          sourceName: query.sourceName ?? null,
        });
        const toInsert: NewSerial[] = fresh.map((row) => ({
          hash: row.hash,
          hint: row.hint,
          category: row.category,
          allowedPageId: row.allowedPageId,
          batchId,
        }));
        const inserted = await repository.insertMany(trx, toInsert);
        // Imported by someone else between the check and the insert.
        const imported = fresh.filter((row) => {
          if (inserted.has(row.hash)) return true;
          duplicates.push({ line: row.line, hint: row.hint, reason: 'Already imported.' });
          return false;
        });
        await repository.setBatchRowCount(trx, batchId, imported.length);
        const outcome = result(batchId, imported);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'serial.import',
          entityType: 'serial_import_batch',
          entityId: batchId,
          // Counts and line numbers only: serials never enter the audit log.
          after: {
            sourceName: query.sourceName ?? null,
            totalRows: outcome.totalRows,
            imported: outcome.imported,
            byCategory: outcome.byCategory,
            duplicateLines: outcome.duplicates.map((issue) => issue.line),
            invalidLines: outcome.invalid.map((issue) => issue.line),
          },
          ipAddress: actor.ipAddress,
        });
        return outcome;
      });
    },

    async deactivate(actor, serial) {
      const normalized = normalizeSerial(serial);
      if (normalized === undefined) throw genericNotFound();
      return db.transaction().execute(async (trx) => {
        const row = await repository.findByHash(trx, hasher.hash(normalized), true);
        if (!row) throw genericNotFound();
        if (row.isActive) await repository.setActive(trx, row.id, false);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'serial.deactivate',
          entityType: 'serial_number',
          entityId: row.id,
          before: toSerialDto(row),
          after: toSerialDto(row, false),
          ipAddress: actor.ipAddress,
        });
        return toSerialDto(row, false);
      });
    },

    async listBatches(query) {
      const page = toPageRequest(query, await deps.settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.listBatches(db, page);
      return {
        items: rows.map((row) => ({
          id: row.id,
          sourceName: row.sourceName,
          rowCount: row.rowCount,
          activeCount: row.activeCount,
          admin:
            row.adminId !== null
              ? { id: row.adminId, displayName: row.adminDisplayName ?? '' }
              : null,
          createdAt: row.createdAt.toISOString(),
        })),
        meta: toPageMeta(page, total),
      };
    },
  };
}
