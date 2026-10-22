'use client';

import { forgotPasswordRequestSchema } from '@urban-ibile/shared';
import { useState, type SyntheticEvent } from 'react';
import { ErrorSummary, Field, StatusMessage, primaryButtonClass } from '@/components/ui/form';
import { bff } from '@/lib/client/bff';
import { validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';
import { useFormState } from './use-form-state';

export function ForgotForm() {
  const { t } = useI18n();
  const form = useFormState();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting) return;
    const result = validate(forgotPasswordRequestSchema, { email });
    if (!result.ok) {
      form.fail(result.errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      await bff('auth/forgot-password', { method: 'POST', json: result.data });
      setSent(true);
    } catch (error) {
      form.fail({}, error);
    } finally {
      form.setSubmitting(false);
    }
  }

  if (sent) return <StatusMessage>{t('auth.forgot.sent')}</StatusMessage>;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-5"
    >
      <p>{t('auth.forgot.intro')}</p>
      <ErrorSummary
        fields={form.errors}
        labels={{ email: t('auth.field.email') }}
        message={form.serverMessage}
        attempt={form.attempt}
      />
      <Field
        name="email"
        label={t('auth.field.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        error={form.errors.email}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <button type="submit" disabled={form.submitting} className={`${primaryButtonClass} w-full`}>
        {form.submitting ? t('form.submitting') : t('auth.forgot.submit')}
      </button>
    </form>
  );
}
