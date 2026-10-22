'use client';

import { loginRequestSchema } from '@urban-ibile/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { ErrorSummary, Field, primaryButtonClass } from '@/components/ui/form';
import { loginHref } from '@/lib/auth/safe-redirect';
import { bff } from '@/lib/client/bff';
import { notifySessionChanged } from '@/lib/client/session';
import { validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';
import { PasswordField } from './password-field';
import { useFormState } from './use-form-state';

const schema = loginRequestSchema.omit({ client: true });

/** `next` is already a validated same-site path (see safeRedirect on the server page). */
export function LoginForm({ next, hasReason }: { next: string; hasReason: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useFormState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting) return;
    const result = validate(schema, { email, password });
    if (!result.ok) {
      form.fail(result.errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      await bff('auth/login', { method: 'POST', json: result.data });
      await queryClient.invalidateQueries();
      notifySessionChanged();
      router.replace(next);
      router.refresh();
    } catch (error) {
      setPassword('');
      form.fail({}, error);
      form.setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-5"
    >
      {hasReason ? <p>{t('auth.login.reason')}</p> : null}
      <ErrorSummary
        fields={form.errors}
        labels={{ email: t('auth.field.email'), password: t('auth.field.password') }}
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
      <PasswordField
        name="password"
        label={t('auth.field.password')}
        autoComplete="current-password"
        value={password}
        error={form.errors.password}
        onChange={setPassword}
      />
      <button type="submit" disabled={form.submitting} className={`${primaryButtonClass} w-full`}>
        {form.submitting ? t('form.submitting') : t('auth.login.submit')}
      </button>
      <p>
        <Link href="/forgot-password" className="underline underline-offset-4">
          {t('auth.login.forgot')}
        </Link>
      </p>
      <p>
        {t('auth.login.no_account')}{' '}
        <Link href={loginHref(next, 'register')} className="underline underline-offset-4">
          {t('auth.login.create_account')}
        </Link>
      </p>
    </form>
  );
}
