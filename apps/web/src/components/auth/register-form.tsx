'use client';

import { registerRequestSchema } from '@urban-ibile/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { CheckboxField, ErrorSummary, Field, primaryButtonClass } from '@/components/ui/form';
import { loginHref } from '@/lib/auth/safe-redirect';
import { bff } from '@/lib/client/bff';
import { notifySessionChanged } from '@/lib/client/session';
import { blankToUndefined, validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';
import { PasswordField } from './password-field';
import { useFormState } from './use-form-state';

const schema = registerRequestSchema.omit({ client: true });

export function RegisterForm({ next }: { next: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useFormState();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting) return;
    const result = validate(schema, {
      fullName,
      email,
      password,
      acceptTerms,
      ...(blankToUndefined(phone) ? { phone: blankToUndefined(phone) } : {}),
    });
    if (!result.ok) {
      form.fail(result.errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      await bff('auth/register', { method: 'POST', json: result.data });
      await queryClient.invalidateQueries();
      notifySessionChanged();
      router.replace(next);
      router.refresh();
    } catch (error) {
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
      <ErrorSummary
        fields={form.errors}
        labels={{
          fullName: t('auth.field.full_name'),
          email: t('auth.field.email'),
          phone: t('auth.field.phone'),
          password: t('auth.field.password'),
          acceptTerms: t('auth.register.terms'),
        }}
        message={form.serverMessage}
        attempt={form.attempt}
      />
      <Field
        name="fullName"
        label={t('auth.field.full_name')}
        autoComplete="name"
        value={fullName}
        error={form.errors.fullName}
        onChange={(event) => {
          setFullName(event.target.value);
        }}
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
      <Field
        name="phone"
        label={t('auth.field.phone')}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        value={phone}
        error={form.errors.phone}
        onChange={(event) => {
          setPhone(event.target.value);
        }}
      />
      <PasswordField
        name="password"
        label={t('auth.field.password')}
        autoComplete="new-password"
        hint={t('auth.password.hint')}
        value={password}
        error={form.errors.password}
        onChange={setPassword}
      />
      <CheckboxField
        name="acceptTerms"
        label={t('auth.register.terms')}
        checked={acceptTerms}
        error={form.errors.acceptTerms}
        onChange={setAcceptTerms}
      />
      <button type="submit" disabled={form.submitting} className={`${primaryButtonClass} w-full`}>
        {form.submitting ? t('form.submitting') : t('auth.register.submit')}
      </button>
      <p>
        {t('auth.register.have_account')}{' '}
        <Link href={loginHref(next)} className="underline underline-offset-4">
          {t('auth.register.sign_in')}
        </Link>
      </p>
    </form>
  );
}
