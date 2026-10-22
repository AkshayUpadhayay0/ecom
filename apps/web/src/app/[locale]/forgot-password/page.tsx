import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotForm } from '@/components/auth/forgot-form';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return { title: t('auth.forgot.title'), robots: { index: false, follow: false } };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = getTranslator(toLocale((await params).locale));
  return (
    <AuthShell title={t('auth.forgot.title')}>
      <ForgotForm />
    </AuthShell>
  );
}
