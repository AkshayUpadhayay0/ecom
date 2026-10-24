import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CartPage } from '@/components/cart/cart-page';
import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { loginHref } from '@/lib/auth/safe-redirect';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return { title: t('cart.title'), robots: { index: false, follow: false } };
}

export default async function CartRoute({ params }: { params: Promise<{ locale: string }> }) {
  const t = getTranslator(toLocale((await params).locale));
  // The hint cookie only decides where to send the visitor; the BFF/API enforce the real session.
  if ((await cookies()).get(COOKIE_NAMES.hint)?.value !== '1') redirect(loginHref('/cart'));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-8 text-3xl font-semibold sm:text-4xl">{t('cart.title')}</h1>
      <CartPage />
    </div>
  );
}
