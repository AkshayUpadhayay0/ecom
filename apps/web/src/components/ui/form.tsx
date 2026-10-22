'use client';

import type { MessageKey } from '@urban-ibile/i18n';
import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/provider';

export const inputClass =
  'w-full border border-ink bg-white px-3 py-2.5 text-base text-ink placeholder:text-ink-muted aria-[invalid=true]:border-2 aria-[invalid=true]:border-red-text';

export const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center bg-emerald px-6 py-2 text-base font-semibold text-ivory disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center border border-ink px-5 py-2 text-base disabled:cursor-not-allowed disabled:opacity-60';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name'> {
  name: string;
  label: string;
  error?: MessageKey | undefined;
  hint?: string | undefined;
  /** Extra element after the input (e.g. a show-password button). */
  trailing?: ReactNode;
}

/** Labelled input with an inline error and hint, wired with aria-describedby. */
export function Field({ name, label, error, hint, trailing, className, ...rest }: FieldProps) {
  const { t } = useI18n();
  const base = useId();
  const id = `${base}-${name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          {...rest}
          id={id}
          name={name}
          data-field={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`${inputClass} ${className ?? ''}`}
        />
        {trailing}
      </div>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-sm font-medium text-red-text">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  error?: MessageKey | undefined;
}

export function SelectField({
  name,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
}: SelectFieldProps) {
  const { t } = useI18n();
  const base = useId();
  const id = `${base}-${name}`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        data-field={name}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={inputClass}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="mt-1 text-sm font-medium text-red-text">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

interface CheckboxProps {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: MessageKey | undefined;
}

export function CheckboxField({ name, label, checked, onChange, error }: CheckboxProps) {
  const { t } = useI18n();
  const base = useId();
  const id = `${base}-${name}`;
  const errorId = `${id}-error`;
  return (
    <div>
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          data-field={name}
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 h-5 w-5 accent-emerald"
        />
        <label htmlFor={id}>{label}</label>
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-sm font-medium text-red-text">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Error summary at the top of a form: announced to screen readers, focused when it appears, and
 * each entry jumps to its field. `attempt` changes on every failed submit so focus moves again.
 */
export function ErrorSummary({
  fields,
  labels,
  message,
  attempt,
}: {
  fields: Record<string, MessageKey>;
  /** Visible label per field name. */
  labels: Record<string, string>;
  /** A form-level message (server error) shown above the field list. */
  message?: string | undefined;
  attempt: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const names = Object.keys(fields);
  const hasContent = names.length > 0 || Boolean(message);

  useEffect(() => {
    if (hasContent) ref.current?.focus();
  }, [attempt, hasContent]);

  if (!hasContent) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="border-2 border-red-text bg-white p-4 text-red-text outline-none"
    >
      {message ? <p className="font-medium">{message}</p> : null}
      {names.length > 0 ? (
        <>
          <p className="font-medium">{t('form.error_summary')}</p>
          <ul className="mt-2 list-disc pl-5">
            {names.map((name) => (
              <li key={name}>
                <a
                  href={`#${name}`}
                  className="underline"
                  onClick={(event) => {
                    event.preventDefault();
                    document
                      .querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`)
                      ?.focus();
                  }}
                >
                  {labels[name] ?? name}
                </a>
                : {t(fields[name] as MessageKey)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Polite status message (success notes). */
export function StatusMessage({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="border-l-4 border-emerald bg-white p-3">
      {children}
    </p>
  );
}
