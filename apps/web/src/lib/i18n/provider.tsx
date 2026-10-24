'use client';

import type { createTranslator } from '@urban-ibile/i18n';
import { type Locale } from '@urban-ibile/i18n';
import { translatorFor } from './translator';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface I18nValue {
  locale: Locale;
  t: ReturnType<typeof createTranslator>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: translatorFor(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translator for client components. Server components use getTranslator(locale). */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
