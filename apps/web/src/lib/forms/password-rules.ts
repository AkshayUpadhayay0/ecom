import type { MessageKey } from '@urban-ibile/i18n';
import type { PublicPasswordRulesDto } from '@urban-ibile/shared';

/**
 * The hint shown under a "new password" field: the real rules from GET /site/config when the API
 * answered, otherwise the general hint. The API still enforces everything (WEAK_PASSWORD).
 */
export function passwordHint(rules: PublicPasswordRulesDto | null): {
  key: MessageKey;
  params: { min: number } | undefined;
} {
  return rules
    ? { key: 'auth.password.rules', params: { min: rules.minLength } }
    : { key: 'auth.password.hint', params: undefined };
}

/** Client-side check of the minimum length (common-password checks stay with the API). */
export function passwordLengthError(
  password: string,
  rules: PublicPasswordRulesDto | null,
): MessageKey | undefined {
  return rules && password.length > 0 && password.length < rules.minLength
    ? 'form.error.password_short'
    : undefined;
}
