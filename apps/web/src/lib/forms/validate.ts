import type { MessageKey } from '@urban-ibile/i18n';
import type { ZodError, ZodType } from 'zod';

export type FieldErrors = Record<string, MessageKey>;

type Issue = ZodError['issues'][number];

/** Zod issue -> dictionary key. The text shown never comes from zod or the API. */
export function issueKey(issue: Issue): MessageKey {
  switch (issue.code) {
    case 'too_small':
      return 'form.error.required';
    case 'too_big':
      return 'form.error.too_long';
    case 'invalid_value':
      return 'form.error.terms';
    case 'invalid_format':
      if (issue.format === 'email') return 'form.error.email';
      // Regex rules in the shared schemas are phone numbers; an invalid uuid means nothing was chosen.
      return issue.format === 'regex' ? 'form.error.phone' : 'form.error.required';
    case 'invalid_type':
      return issue.input === undefined || issue.input === null || issue.input === ''
        ? 'form.error.required'
        : 'form.error.number';
    default:
      return 'form.error.required';
  }
}

export type Validation<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Validates form values with a shared zod schema; one message per field (the first issue). */
export function validate<T>(schema: ZodType<T>, values: unknown): Validation<T> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_form';
    errors[field] ??= issueKey(issue);
  }
  return { ok: false, errors };
}

/** Empty optional text fields are sent as "not provided". */
export function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
