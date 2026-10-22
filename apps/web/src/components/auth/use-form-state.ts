'use client';

import { useCallback, useState } from 'react';
import { describeError } from '@/lib/client/error-messages';
import type { FieldErrors } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';

/**
 * Shared bookkeeping for the small account forms: field errors, a server-level message (already
 * translated through the dictionary), the submitting flag and an attempt counter that re-focuses
 * the error summary on every failed submit.
 */
export function useFormState() {
  const { t } = useI18n();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverMessage, setServerMessage] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback(
    (fieldErrors: FieldErrors, error?: unknown) => {
      setErrors(fieldErrors);
      setServerMessage(
        error === undefined
          ? undefined
          : (() => {
              const described = describeError(error);
              return t(described.key, described.params);
            })(),
      );
      setAttempt((n) => n + 1);
    },
    [t],
  );

  const reset = useCallback(() => {
    setErrors({});
    setServerMessage(undefined);
  }, []);

  return { errors, serverMessage, submitting, setSubmitting, attempt, fail, reset };
}
