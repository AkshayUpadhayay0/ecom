'use client';

import type { DecisionDto } from '@urban-ibile/shared';
import { useEffect, useReducer, useRef, type SyntheticEvent } from 'react';
import { primaryButtonClass, secondaryButtonClass, inputClass } from '@/components/ui/form';
import { BODY_SCAN_ENABLED } from '@/config/env';
import { blueprintApi, runBodyScan } from '@/lib/blueprint/api';
import { decisionBody, initialState, previewBody, reduce } from '@/lib/blueprint/machine';
import { BffError } from '@/lib/client/bff';
import { describeError } from '@/lib/client/error-messages';
import { useI18n } from '@/lib/i18n/provider';

export interface SupportContacts {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}

interface Props {
  productId: string;
  open: boolean;
  support: SupportContacts;
  onClose: () => void;
  onDecided: (decision: DecisionDto) => void;
}

function failureOf(error: unknown): { code: string; details?: unknown } {
  return error instanceof BffError
    ? { code: error.code, details: error.details }
    : { code: 'UNKNOWN' };
}

/** Measurement codes the API pointed at (typed issues or out-of-range entries). */
function flaggedCodes(details: unknown): Set<string> {
  const codes = new Set<string>();
  if (typeof details !== 'object' || details === null) return codes;
  const { issues, measurements } = details as { issues?: unknown; measurements?: unknown };
  for (const list of [issues, measurements]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const { code, field } = item as { code?: unknown; field?: unknown };
      if (typeof code === 'string') codes.add(code);
      if (typeof field === 'string') codes.add(field);
    }
  }
  return codes;
}

function contactText(support: SupportContacts): string | null {
  const parts = [support.email, support.phone, support.whatsapp].filter(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Find My Size (Blueprint). Mobile-first full-screen sheet that becomes a centred dialog on larger
 * screens (native <dialog>: focus trap, Esc and focus return come from the browser). The flow is
 * the pure state machine in lib/blueprint/machine.ts; this component renders it and performs the
 * calls it asks for. The size is always decided by the API, never here.
 */
export default function FindMySizeDialog({ productId, open, support, onClose, onDecided }: Props) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(reduce, initialState);
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const contact = contactText(support);

  // Open / close the native dialog with the parent's flag.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) element.showModal();
      dispatch({ type: 'open' });
    } else {
      if (element.open) element.close();
      dispatch({ type: 'close' });
    }
  }, [open]);

  // Network steps.
  useEffect(() => {
    let cancelled = false;
    const guard =
      <T,>(action: (value: T) => void) =>
      (value: T) => {
        if (!cancelled) action(value);
      };
    if (state.step === 'loading') {
      blueprintApi.requirements(productId).then(
        guard((requirements) => {
          dispatch({ type: 'requirements_loaded', requirements });
        }),
        guard((error: unknown) => {
          dispatch({ type: 'requirements_failed', failure: failureOf(error) });
        }),
      );
    } else if (state.step === 'scanning') {
      runBodyScan(productId).then(
        guard((session) => {
          if (session.status === 'COMPLETED')
            dispatch({ type: 'scan_ready', bodyScanSessionId: session.id });
          else dispatch({ type: 'scan_failed', failure: { code: 'BODY_SCAN_NOT_READY' } });
        }),
        guard((error: unknown) => {
          dispatch({ type: 'scan_failed', failure: failureOf(error) });
        }),
      );
    } else if (state.step === 'previewing' && state.input) {
      blueprintApi.preview(previewBody(productId, state.fitPreference, state.input)).then(
        guard((recommendation) => {
          dispatch({ type: 'preview_ok', recommendation });
        }),
        guard((error: unknown) => {
          dispatch({ type: 'preview_failed', failure: failureOf(error) });
        }),
      );
    } else if (state.step === 'saving') {
      const request = decisionBody(productId, state);
      if (request) {
        blueprintApi.decide(request).then(
          guard((decision) => {
            dispatch({ type: 'save_ok', decision });
          }),
          guard((error: unknown) => {
            dispatch({ type: 'save_failed', failure: failureOf(error) });
          }),
        );
      }
    }
    return () => {
      cancelled = true;
    };
    // The step drives the calls; the other state fields are read when the step is entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  // Hand the decision to the parent and close.
  useEffect(() => {
    if (state.step === 'done' && state.decision) {
      onDecided(state.decision);
      onClose();
    }
  }, [state.step, state.decision, onDecided, onClose]);

  // Move focus into the step that just appeared (first field, or the result heading).
  useEffect(() => {
    if (!open) return;
    const target = body.current?.querySelector<HTMLElement>('[data-autofocus]');
    target?.focus();
  }, [state.step, open]);

  const failure = state.failure;
  const described = failure
    ? describeError(new BffError(0, failure.code, '', failure.details))
    : null;
  const flagged = failure ? flaggedCodes(failure.details) : new Set<string>();
  const outOfRange = failure?.code === 'BLUEPRINT_OUT_OF_RANGE';
  const busy =
    state.step === 'loading' ||
    state.step === 'previewing' ||
    state.step === 'saving' ||
    state.step === 'scanning';
  const requirements = state.requirements;
  const recommendation = state.recommendation;

  function onMeasure(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    dispatch({ type: 'submit_measurements' });
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="fms-title"
      onClose={onClose}
      onCancel={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-ivory p-0 text-ink backdrop:bg-ink/60 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-xl"
    >
      <div
        ref={body}
        className="flex max-h-dvh flex-col overflow-y-auto p-5 sm:max-h-[90dvh] sm:p-8"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="fms-title" className="text-2xl font-semibold">
            {t('fms.title')}
          </h2>
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} px-3`}>
            {t('form.close')}
          </button>
        </div>

        {described ? (
          <div role="alert" className="mb-4 border-2 border-red-text bg-white p-3 text-red-text">
            <p className="font-medium">{t(described.key, described.params)}</p>
            {outOfRange && contact ? <p className="mt-1">{t('fms.contact', { contact })}</p> : null}
          </div>
        ) : null}

        {state.step === 'loading' ? (
          <p data-autofocus tabIndex={-1} aria-live="polite">
            {t('form.loading')}
          </p>
        ) : null}

        {state.step === 'previewing' ? (
          <p data-autofocus tabIndex={-1} aria-live="polite">
            {t('fms.working')}
          </p>
        ) : null}
        {state.step === 'scanning' ? (
          <p data-autofocus tabIndex={-1} aria-live="polite">
            {t('fms.scan.working')}
          </p>
        ) : null}
        {state.step === 'saving' ? (
          <p data-autofocus tabIndex={-1} aria-live="polite">
            {t('fms.saving')}
          </p>
        ) : null}

        {state.step === 'measuring' && requirements ? (
          <form noValidate onSubmit={onMeasure} className="space-y-5">
            <p>{t('fms.intro')}</p>
            {requirements.measurements.map((measurement, index) => {
              const error = state.errors[measurement.code];
              const inputId = `fms-${measurement.code}`;
              const invalid = Boolean(error) || flagged.has(measurement.code);
              return (
                <div key={measurement.code}>
                  <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
                    {measurement.label}{' '}
                    <span className="text-ink-muted">({t('fms.measure.unit')})</span>
                  </label>
                  <input
                    id={inputId}
                    {...(index === 0 ? { 'data-autofocus': true } : {})}
                    inputMode="decimal"
                    autoComplete="off"
                    value={state.texts[measurement.code] ?? ''}
                    aria-invalid={invalid ? true : undefined}
                    aria-describedby={`${inputId}-help${error ? ` ${inputId}-error` : ''}`}
                    onChange={(event) => {
                      dispatch({ type: 'type', code: measurement.code, text: event.target.value });
                    }}
                    className={inputClass}
                  />
                  <p id={`${inputId}-help`} className="mt-1 text-sm text-ink-muted">
                    {measurement.helpText ? `${measurement.helpText} ` : ''}
                    {t('fms.measure.hint_decimals')}
                  </p>
                  {error ? (
                    <p id={`${inputId}-error`} className="mt-1 text-sm font-medium text-red-text">
                      {t(error.error, error.params)}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('fms.fit.legend')}</legend>
              <div className="flex flex-wrap gap-4">
                {requirements.fitOptions.map((option) => (
                  <label key={option.code} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="fit"
                      value={option.code}
                      checked={state.fitPreference === option.code}
                      onChange={() => {
                        dispatch({ type: 'set_fit', fitPreference: option.code });
                      }}
                      className="h-5 w-5 accent-emerald"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-sm text-ink-muted">{t('fms.fit.note')}</p>
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={primaryButtonClass}>
                {t('fms.submit')}
              </button>
              {BODY_SCAN_ENABLED && requirements.bodyScan.available ? (
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => {
                    dispatch({ type: 'start_scan' });
                  }}
                >
                  {t('fms.scan.start')}
                </button>
              ) : null}
            </div>
            {BODY_SCAN_ENABLED &&
            requirements.bodyScan.available &&
            requirements.bodyScan.mocked ? (
              <p className="text-sm text-ink-muted">{t('fms.scan.mock')}</p>
            ) : null}
          </form>
        ) : null}

        {state.step === 'review' && recommendation ? (
          <div className="space-y-6">
            <section aria-labelledby="fms-result">
              <h3
                id="fms-result"
                data-autofocus
                tabIndex={-1}
                className="text-lg font-semibold outline-none"
              >
                {t('fms.result.heading')}
              </h3>
              <p className="mt-1 text-4xl font-semibold" data-testid="recommended-size">
                {t('fms.result.size', { size: recommendation.recommendedSize.code })}
              </p>
              <p className="text-ink-muted">{recommendation.recommendedSize.label}</p>
              {recommendation.mocked ? (
                <p className="mt-2 text-sm text-ink-muted">{t('fms.scan.mock')}</p>
              ) : null}
              {!recommendation.recommendedOffered ? (
                <p className="mt-3 border-l-4 border-marigold bg-white p-3">
                  {t('fms.result.not_offered', { size: recommendation.recommendedSize.code })}
                </p>
              ) : !recommendation.recommendedInStock ? (
                <p className="mt-3 border-l-4 border-marigold bg-white p-3">
                  {t('fms.result.out_of_stock', { size: recommendation.recommendedSize.code })}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="fms-breakdown">
              <h3 id="fms-breakdown" className="text-base font-semibold">
                {t('fms.result.breakdown')}
              </h3>
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1 pr-2">
                      {t('fms.result.col_measure')}
                    </th>
                    <th scope="col" className="py-1 pr-2">
                      {t('fms.result.col_value')}
                    </th>
                    <th scope="col" className="py-1">
                      {t('fms.result.col_size')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recommendation.breakdown.map((row) => (
                    <tr key={row.code} className="border-b border-line">
                      <th scope="row" className="py-1 pr-2 font-normal">
                        {row.label}
                      </th>
                      <td className="py-1 pr-2">
                        {row.valueInches} {t('fms.measure.unit')}
                      </td>
                      <td className="py-1">{row.requiredSize.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-ink-muted">{t('fms.result.rule')}</p>
            </section>

            {recommendation.recommendedOffered ? (
              <button
                type="button"
                className={`${primaryButtonClass} w-full`}
                disabled={busy}
                onClick={() => {
                  dispatch({ type: 'choose', choice: 'recommended' });
                  dispatch({ type: 'save' });
                }}
              >
                {t('fms.accept', { size: recommendation.recommendedSize.code })}
              </button>
            ) : null}

            <fieldset className="space-y-2 border-t border-line pt-4">
              <legend className="text-base font-semibold">{t('fms.other.heading')}</legend>
              <p className="text-sm">{t('fms.other.body')}</p>
              <p className="sr-only">{t('fms.other.legend')}</p>
              <div className="flex flex-wrap gap-3">
                {recommendation.alternatives
                  .filter((size) => size.id !== recommendation.recommendedSize.id)
                  .map((size) => (
                    <label
                      key={size.id}
                      className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 ${
                        state.choice === size.id ? 'border-2 border-emerald bg-white' : 'border-ink'
                      }`}
                    >
                      <input
                        type="radio"
                        name="other-size"
                        value={size.id}
                        checked={state.choice === size.id}
                        onChange={() => {
                          dispatch({ type: 'choose', choice: size.id });
                        }}
                        className="h-5 w-5 accent-emerald"
                      />
                      <span className="font-semibold">{size.code}</span>
                      <span className="text-sm text-ink-muted">
                        {t(`size.${size.availability}`)}
                      </span>
                    </label>
                  ))}
              </div>
              {state.choice !== '' && state.choice !== 'recommended' ? (
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={busy}
                  onClick={() => {
                    dispatch({ type: 'save' });
                  }}
                >
                  {t('fms.other.confirm', {
                    size:
                      recommendation.alternatives.find((size) => size.id === state.choice)?.code ??
                      '',
                  })}
                </button>
              ) : null}
            </fieldset>

            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                dispatch({ type: 'edit_measurements' });
              }}
            >
              {t('fms.back')}
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
