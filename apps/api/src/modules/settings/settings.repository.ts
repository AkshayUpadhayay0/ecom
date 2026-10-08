import type { Database } from '../../db/database.js';

export interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

const SETTING_COLUMNS = [
  'setting_key as key',
  'value',
  'description',
  'updated_at as updatedAt',
  'updated_by as updatedBy',
] as const;

export interface SettingsRepository {
  listAll(db: Database): Promise<SettingRow[]>;
  findByKey(db: Database, key: string): Promise<SettingRow | undefined>;
  /** Inserts or replaces the value. `null` is stored as SQL NULL ("not provided yet"). */
  upsert(db: Database, key: string, value: unknown, adminId: string): Promise<SettingRow>;
}

/** jsonb parameter: SQL NULL for null, JSON text otherwise. */
function toJsonb(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

export function createSettingsRepository(): SettingsRepository {
  return {
    async listAll(db) {
      return db.selectFrom('app_settings').select(SETTING_COLUMNS).orderBy('setting_key').execute();
    },

    async findByKey(db, key) {
      return db
        .selectFrom('app_settings')
        .select(SETTING_COLUMNS)
        .where('setting_key', '=', key)
        .executeTakeFirst();
    },

    async upsert(db, key, value, adminId) {
      return db
        .insertInto('app_settings')
        .values({ setting_key: key, value: toJsonb(value), updated_by: adminId })
        .onConflict((oc) =>
          oc.column('setting_key').doUpdateSet((eb) => ({
            value: eb.ref('excluded.value'),
            updated_by: eb.ref('excluded.updated_by'),
            updated_at: eb.fn('now'),
          })),
        )
        .returning(SETTING_COLUMNS)
        .executeTakeFirstOrThrow();
    },
  };
}
