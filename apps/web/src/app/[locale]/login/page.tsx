import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { safeRedirect } from '@/lib/auth/safe-redirect';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import type { RawSearchParams } from '@/lib/list-params';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return { title: t('auth.login.title'), robots: { index: false, follow: false } };
}

export default async function LoginPage({ params, searchParams }: PageProps) {
  const locale = toLocale((await params).locale);
  const t = getTranslator(locale);
  const raw = (await searchParams).next;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const next = safeRedirect(requested);
  if ((await cookies()).get(COOKIE_NAMES.hint)?.value === '1') redirect(next);
  return (
    <AuthShell title={t('auth.login.title')}>
      <LoginForm next={next} hasReason={next !== '/'} />
    </AuthShell>
  );
}
