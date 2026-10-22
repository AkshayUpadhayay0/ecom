import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccountPage } from '@/components/account/account-page';
import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { loginHref } from '@/lib/auth/safe-redirect';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return { title: t('account.title'), robots: { index: false, follow: false } };
}

export default async function AccountRoute({ params }: { params: Promise<{ locale: string }> }) {
  const t = getTranslator(toLocale((await params).locale));
  // The hint cookie only decides where to send the visitor; the BFF/API enforce the real session.
  if ((await cookies()).get(COOKIE_NAMES.hint)?.value !== '1') redirect(loginHref('/account'));
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-8 text-3xl font-semibold sm:text-4xl">{t('account.title')}</h1>
      <AccountPage />
    </div>
  );
}
