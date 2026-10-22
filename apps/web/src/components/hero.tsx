import type { Locale } from '@urban-ibile/i18n';
import type { PublicHeroDto } from '@urban-ibile/shared';
import Link from 'next/link';
import { BRAND_NAME } from '@/brand/brand';
import { getTranslator } from '@/lib/i18n/server';
import { HeroMedia } from './hero-media';

interface HeroCopy {
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
}

function copyFor(hero: PublicHeroDto | null, locale: Locale, fallbackLocale: string): HeroCopy {
  const all = hero?.translations ?? {};
  const pick = (code: string): Partial<HeroCopy> =>
    (all as Record<string, Partial<HeroCopy> | undefined>)[code] ?? {};
  const chosen = pick(locale);
  const fallback = pick(fallbackLocale);
  return {
    title: chosen.title ?? fallback.title ?? null,
    body: chosen.body ?? fallback.body ?? null,
    ctaLabel: chosen.ctaLabel ?? fallback.ctaLabel ?? null,
  };
}

/**
 * Homepage hero. Text sits on an ink overlay (token colours) so it stays readable on any frame.
 * With no published hero video a branded emerald block is shown instead of an empty space.
 * The CTA always goes to Shop: the API gives the label only, no destination.
 */
export function Hero({
  hero,
  locale,
  defaultLanguage,
}: {
  hero: PublicHeroDto | null;
  locale: Locale;
  defaultLanguage: string;
}) {
  const t = getTranslator(locale);
  const copy = copyFor(hero, locale, defaultLanguage);
  const video = hero?.video ?? null;
  const title = copy.title ?? BRAND_NAME;

  return (
    <section
      aria-label={t('home.hero_label')}
      className="on-dark relative isolate flex min-h-[70svh] items-end overflow-hidden bg-emerald text-ivory"
    >
      {video ? <HeroMedia video={video} /> : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-ink/85 via-ink/40 to-ink/10"
      />
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-32 sm:px-6 lg:px-8">
        <h1 className="max-w-3xl text-4xl font-semibold sm:text-5xl lg:text-6xl">{title}</h1>
        {copy.body ? <p className="mt-4 max-w-xl text-lg font-body">{copy.body}</p> : null}
        <Link
          href="/shop"
          className="mt-8 inline-flex min-h-14 items-center bg-red px-8 text-2xl font-semibold text-white"
        >
          {copy.ctaLabel ?? t('home.hero_fallback_cta')}
        </Link>
      </div>
    </section>
  );
}
