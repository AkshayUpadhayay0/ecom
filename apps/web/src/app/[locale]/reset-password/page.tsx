import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetForm } from '@/components/auth/reset-form';
import { getSiteConfig, passwordRulesFrom } from '@/lib/api/public';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  // The link carries a one-time secret: never send it onward in a Referer header.
  return {
    title: t('auth.reset.title'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = getTranslator(toLocale((await params).locale));
  const config = await getSiteConfig().catch(() => null);
  return (
    <AuthShell title={t('auth.reset.title')}>
      <ResetForm rules={passwordRulesFrom(config)} />
    </AuthShell>
  );
}
