'use client';

import { updateMeRequestSchema, type CustomerDto } from '@urban-ibile/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useFormState } from '@/components/auth/use-form-state';
import {
  ErrorSummary,
  Field,
  StatusMessage,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/form';
import { bff } from '@/lib/client/bff';
import { describeError } from '@/lib/client/error-messages';
import { ME_KEY } from '@/lib/client/session';
import { validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';

export function ProfileSection({ customer }: { customer: CustomerDto }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const form = useFormState();
  const [fullName, setFullName] = useState(customer.fullName);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [saved, setSaved] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting) return;
    setSaved(false);
    const result = validate(updateMeRequestSchema, {
      fullName,
      phone: phone.trim() === '' ? null : phone,
    });
    if (!result.ok) {
      form.fail(result.errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      const updated = await bff<CustomerDto>('auth/me', { method: 'PATCH', json: result.data });
      queryClient.setQueryData(ME_KEY, updated);
      setSaved(true);
    } catch (error) {
      form.fail({}, error);
    } finally {
      form.setSubmitting(false);
    }
  }

  async function resend(): Promise<void> {
    try {
      await bff('auth/resend-verification', { method: 'POST' });
      setResendNote(t('account.resend_sent'));
    } catch (error) {
      const described = describeError(error);
      setResendNote(t(described.key, described.params));
    }
  }

  return (
    <section aria-labelledby="profile-heading" className="space-y-5">
      <h2 id="profile-heading" className="text-xl font-semibold">
        {t('account.profile')}
      </h2>
      <p>{customer.email}</p>
      {customer.emailVerified ? (
        <StatusMessage>{t('account.email_verified')}</StatusMessage>
      ) : (
        <div className="space-y-2 border-l-4 border-marigold bg-white p-3">
          <p>{t('account.email_unverified')}</p>
          <button
            type="button"
            onClick={() => {
              void resend();
            }}
            className={secondaryButtonClass}
          >
            {t('account.resend')}
          </button>
          {resendNote ? <p role="status">{resendNote}</p> : null}
        </div>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        className="max-w-md space-y-5"
      >
        <ErrorSummary
          fields={form.errors}
          labels={{ fullName: t('auth.field.full_name'), phone: t('auth.field.phone') }}
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
          name="phone"
          label={t('auth.field.phone')}
          type="tel"
          autoComplete="tel"
          value={phone}
          error={form.errors.phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
        <button type="submit" disabled={form.submitting} className={primaryButtonClass}>
          {form.submitting ? t('form.submitting') : t('form.save')}
        </button>
        {saved ? <StatusMessage>{t('account.profile_saved')}</StatusMessage> : null}
      </form>
    </section>
  );
}
