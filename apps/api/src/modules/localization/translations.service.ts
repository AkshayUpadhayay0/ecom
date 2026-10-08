import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { LanguagesRepository } from './languages.repository.js';

export interface TranslationRules {
  /** Create: the default language must be present. */
  requireDefault: boolean;
}

export interface TranslationsService {
  /**
   * Checks a `{ [languageCode]: value | null }` map against the active languages (from the
   * `languages` table, never hard-coded). `null` removes a translation and is never allowed for
   * the default language. Throws VALIDATION_ERROR listing every problem.
   */
  assertValid(
    db: Database,
    translations: Readonly<Record<string, unknown>>,
    rules: TranslationRules,
  ): Promise<void>;
  /** Code of the default language (English). */
  defaultLanguage(db: Database): Promise<string>;
  /** True if `code` is an active language. */
  isActiveLanguage(db: Database, code: string): Promise<boolean>;
}

interface Issue {
  path: string;
  message: string;
}

export function createTranslationsService(repository: LanguagesRepository): TranslationsService {
  async function defaultLanguage(db: Database): Promise<string> {
    const languages = await repository.listActive(db);
    const fallback = languages.find((language) => language.isDefault) ?? languages[0];
    if (!fallback) throw new Error('No active language configured.');
    return fallback.code;
  }

  return {
    async assertValid(db, translations, rules) {
      const languages = await repository.listActive(db);
      const active = new Set(languages.map((language) => language.code));
      const defaultCode = languages.find((language) => language.isDefault)?.code;
      const issues: Issue[] = [];

      for (const [code, value] of Object.entries(translations)) {
        if (!active.has(code)) {
          issues.push({ path: `translations.${code}`, message: 'Unknown or inactive language.' });
        } else if (value === null && code === defaultCode) {
          issues.push({
            path: `translations.${code}`,
            message: 'The default language translation cannot be removed.',
          });
        }
      }
      if (rules.requireDefault && defaultCode !== undefined && translations[defaultCode] == null) {
        issues.push({
          path: `translations.${defaultCode}`,
          message: 'The default language translation is required.',
        });
      }
      if (issues.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Request validation failed.',
          { issues },
        );
      }
    },

    defaultLanguage,

    async isActiveLanguage(db, code) {
      return (await repository.listActive(db)).some((language) => language.code === code);
    },
  };
}

/** Splits a translation patch into rows to upsert and languages to remove (`null`). */
export function splitTranslationPatch<T>(patch: Readonly<Record<string, T | null>>): {
  upserts: Record<string, T>;
  removals: string[];
} {
  const upserts: Record<string, T> = {};
  const removals: string[] = [];
  for (const [code, value] of Object.entries(patch)) {
    if (value === null) removals.push(code);
    else upserts[code] = value;
  }
  return { upserts, removals };
}
