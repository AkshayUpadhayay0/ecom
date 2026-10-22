'use client';

import type { MessageKey } from '@urban-ibile/i18n';
import { useState } from 'react';
import { PASSWORD_MAX_LENGTH } from '@urban-ibile/shared';
import { useI18n } from '@/lib/i18n/provider';
import { Field, secondaryButtonClass } from '@/components/ui/form';

interface Props {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey | undefined;
  hint?: string | undefined;
  autoComplete: 'current-password' | 'new-password';
}

/** Password input with a show/hide toggle (never sent anywhere but the BFF, never logged). */
export function PasswordField({ name, label, value, onChange, error, hint, autoComplete }: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      name={name}
      label={label}
      type={visible ? 'text' : 'password'}
      value={value}
      maxLength={PASSWORD_MAX_LENGTH}
      autoComplete={autoComplete}
      error={error}
      hint={hint}
      spellCheck={false}
      autoCapitalize="none"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      trailing={
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
          className={`${secondaryButtonClass} shrink-0 px-3 text-sm`}
        >
          {visible ? t('auth.password.hide') : t('auth.password.show')}
        </button>
      }
    />
  );
}
