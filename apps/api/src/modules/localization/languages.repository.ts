import type { Database } from '../../db/database.js';

export interface LanguageRow {
  code: string;
  isDefault: boolean;
}

export interface LanguagesRepository {
  listActive(db: Database): Promise<LanguageRow[]>;
}

export function createLanguagesRepository(): LanguagesRepository {
  return {
    async listActive(db) {
      return db
        .selectFrom('languages')
        .select(['code', 'is_default as isDefault'])
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute();
    },
  };
}
