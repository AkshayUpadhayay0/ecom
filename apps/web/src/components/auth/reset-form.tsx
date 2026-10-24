'use client';

import { resetPasswordRequestSchema, type PublicPasswordRulesDto } from '@urban-ibile/shared';
import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import { ErrorSummary, StatusMessage, primaryButtonClass } from '@/components/ui/form';
import { bff } from '@/lib/client/bff';
import { passwordHint, passwordLengthError } from '@/lib/forms/password-rules';
import type { FieldErrors } from '@/lib/forms/validate';
import { validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';
import { PasswordField } from './password-field';
import { useUrlToken } from './token-page-helpers';
import { useFormState } from './use-form-state';

const schema = resetPasswordRequestSchema.pick({ newPassword: true });

export function ResetForm({ rules }: { rules: PublicPasswordRulesDto | null }) {
  const hint = passwordHint(rules);
  const { t } = useI18n();
  const { token, ready } = useUrlToken();
  const form = useFormState();
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting || !token) return;
    const result = validate(schema, { newPassword });
    const tooShort = passwordLengthError(newPassword, rules);
    if (!result.ok || tooShort) {
      const errors: FieldErrors = result.ok ? {} : { ...result.errors };
      if (tooShort && !('newPassword' in errors)) errors.newPassword = tooShort;
      form.fail(errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      await bff('auth/reset-password', {
        method: 'POST',
        json: { token, newPassword: result.data.newPassword },
      });
      setNewPassword('');
      setDone(true);
    } catch (error) {
      form.fail({}, error);
    } finally {
      form.setSubmitting(false);
    }
  }

  if (!ready) return <p>{t('form.loading')}</p>;
  if (done) {
    return (
      <div className="space-y-4">
        <StatusMessage>{t('auth.reset.done')}</StatusMessage>
        <Link href="/login" className="underline underline-offset-4">
          {t('auth.login.submit')}
        </Link>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-red-text">
          {t('auth.reset.missing_token')}
        </p>
        <Link href="/forgot-password" className="underline underline-offset-4">
          {t('auth.forgot.title')}
        </Link>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-5"
    >
      <ErrorSummary
        fields={form.errors}
        labels={{ newPassword: t('auth.field.new_password') }}
        message={form.serverMessage}
        attempt={form.attempt}
      />
      <PasswordField
        name="newPassword"
        label={t('auth.field.new_password')}
        autoComplete="new-password"
        hint={t(hint.key, hint.params)}
        value={newPassword}
        error={form.errors.newPassword}
        onChange={setNewPassword}
      />
      <button type="submit" disabled={form.submitting} className={`${primaryButtonClass} w-full`}>
        {form.submitting ? t('form.submitting') : t('auth.reset.submit')}
      </button>
    </form>
  );
}
