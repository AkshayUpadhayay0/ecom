import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getContentBlock } from '@/lib/api/public';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import { isPolicySlug, policyBlockKey } from '@/lib/site-links';

// Next reads this export statically, so it must be a literal (60 s, as CATALOG_REVALIDATE_SECONDS).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string; key: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, key } = await params;
  if (!isPolicySlug(key)) return {};
  const block = await getContentBlock(policyBlockKey(key)).catch(() => null);
  const t = getTranslator(toLocale(locale));
  return { title: block?.title ?? t(`policy.link.${key}`) };
}

/**
 * Policy text (privacy, terms, returns): plain text supplied in Admin → Content. A policy the
 * client has not supplied yet is a 404 (and is not linked anywhere).
 */
export default async function PolicyPage({ params }: PageProps) {
  const { locale, key } = await params;
  if (!isPolicySlug(key)) notFound();
  const block = await getContentBlock(policyBlockKey(key)).catch(() => null);
  if (!block || block.status !== 'available') notFound();
  const t = getTranslator(toLocale(locale));

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="type-heading">{block.title ?? t(`policy.link.${key}`)}</h1>
      <div className="prose-body mt-8 space-y-4">
        {block.parts.map((part, index) =>
          part.type === 'heading' ? (
            <h2 key={index} className="pt-4 text-xl font-semibold">
              {part.text}
            </h2>
          ) : (
            <p key={index}>{part.text}</p>
          ),
        )}
      </div>
    </article>
  );
}
