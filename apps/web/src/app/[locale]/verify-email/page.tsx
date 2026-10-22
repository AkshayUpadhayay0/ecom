import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmail } from '@/components/auth/verify-email';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return {
    title: t('auth.verify.title'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const t = getTranslator(toLocale((await params).locale));
  return (
    <AuthShell title={t('auth.verify.title')}>
      <VerifyEmail />
    </AuthShell>
  );
}
