import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  isSettingKey,
  type SettingDto,
  type SettingKey,
} from '@urban-ibile/shared';
import { ZodError } from 'zod';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { writeAuditLog } from '../audit/audit-log.repository.js';
import type { AuditActor } from '../audit/audit-actor.js';
import { toSettingDto } from './settings.dto.js';
import type { SettingsRepository } from './settings.repository.js';

/** Settings that have a numeric default (operational limits read by other services). */
export type LimitSettingKey = {
  [K in SettingKey]: (typeof SETTING_DEFINITIONS)[K] extends { default: number } ? K : never;
}[SettingKey];

export interface SettingsService {
  list(): Promise<SettingDto[]>;
  update(actor: AuditActor, key: string, value: unknown): Promise<SettingDto>;
  /**
   * Current value of a numeric limit, or its documented default while the stored value is NULL
   * (or invalid). Pass a transaction to read inside it.
   */
  getLimit(db: Database, key: LimitSettingKey): Promise<number>;
}

export interface SettingsServiceDeps {
  db: Database;
  repository: SettingsRepository;
}

function validateValue(key: SettingKey, value: unknown): unknown {
  if (value === null) return null;
  const result = SETTING_DEFINITIONS[key].schema.safeParse(value);
  if (!result.success) {
    throw new ZodError(
      result.error.issues.map((issue) => ({ ...issue, path: ['value', ...issue.path] })),
    );
  }
  return result.data;
}

export function createSettingsService({ db, repository }: SettingsServiceDeps): SettingsService {
  return {
    async list() {
      const rows = new Map((await repository.listAll(db)).map((row) => [row.key, row]));
      // Known keys first (even if the seed has no row yet), then any extra stored rows.
      const known = SETTING_KEYS.map((key) => toSettingDto(key, rows.get(key)));
      const extra = [...rows.values()]
        .filter((row) => !isSettingKey(row.key))
        .map((row) => toSettingDto(row.key, row));
      return [...known, ...extra];
    },

    async update(actor, key, value) {
      if (!isSettingKey(key)) {
        throw new AppError(
          'UNKNOWN_SETTING',
          HTTP_STATUS.BAD_REQUEST,
          `Unknown setting "${key}".`,
          {
            knownKeys: SETTING_KEYS,
          },
        );
      }
      const parsed = validateValue(key, value);
      const row = await db.transaction().execute(async (trx) => {
        const before = await repository.findByKey(trx, key);
        const after = await repository.upsert(trx, key, parsed, actor.adminId);
        await writeAuditLog(trx, {
          adminId: actor.adminId,
          action: 'setting.update',
          entityType: 'setting',
          entityId: key,
          before: { value: before?.value ?? null },
          after: { value: after.value },
          ipAddress: actor.ipAddress,
        });
        return after;
      });
      return toSettingDto(key, row);
    },

    async getLimit(executor, key) {
      const definition = SETTING_DEFINITIONS[key];
      const row = await repository.findByKey(executor, key);
      const result = definition.schema.safeParse(row?.value);
      return result.success ? result.data : definition.default;
    },
  };
}
