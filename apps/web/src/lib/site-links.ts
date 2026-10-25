import type { Locale } from '@urban-ibile/i18n';
import type { PublicClothingTypeDto } from '@urban-ibile/shared';
import { cache } from 'react';
import { getClothingTypes, getContentBlock, getSiteConfig, supportFrom } from '@/lib/api/public';
import { getTranslator } from '@/lib/i18n/server';

export interface SiteLink {
  href: string;
  label: string;
  /** Opens outside the site (mailto, tel, WhatsApp). */
  external?: boolean;
}

export interface SiteLinks {
  clothingTypes: PublicClothingTypeDto[];
  /** Contact links: only the ones the client supplied in Settings. */
  support: SiteLink[];
  /** Policy pages: only the ones whose content exists (not pending). */
  policies: SiteLink[];
}

/** Policy pages the site can show (content blocks `policy.<slug>`). */
export const POLICY_SLUGS = ['privacy', 'terms', 'returns'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

export function isPolicySlug(value: string): value is PolicySlug {
  return (POLICY_SLUGS as readonly string[]).includes(value);
}

export const policyBlockKey = (slug: PolicySlug): string => `policy.${slug}`;

/** Links for the contact details that were supplied; the visible text is the detail itself. */
export function supportLinks(support: {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}): SiteLink[] {
  const links: SiteLink[] = [];
  if (support.email) {
    links.push({ href: `mailto:${support.email}`, label: support.email, external: true });
  }
  const phone = support.phone?.replace(/[^\d+]/g, '');
  if (support.phone && phone) {
    links.push({ href: `tel:${phone}`, label: support.phone, external: true });
  }
  const whatsapp = support.whatsapp?.replace(/\D/g, '');
  if (support.whatsapp && whatsapp) {
    links.push({ href: `https://wa.me/${whatsapp}`, label: support.whatsapp, external: true });
  }
  return links;
}

/**
 * What the menu and footer link to. Everything is optional content: nothing is shown until the
 * client has supplied it. One request per render (React cache), all cached for 60 s by the API client.
 */
export const getSiteLinks = cache(async (locale: Locale): Promise<SiteLinks> => {
  const t = getTranslator(locale);
  const [config, clothingTypes, blocks] = await Promise.all([
    getSiteConfig().catch(() => null),
    getClothingTypes().catch(() => []),
    Promise.all(
      POLICY_SLUGS.map((slug) => getContentBlock(policyBlockKey(slug)).catch(() => null)),
    ),
  ]);
  const policies = POLICY_SLUGS.flatMap((slug, index): SiteLink[] =>
    blocks[index]?.status === 'available'
      ? [{ href: `/policies/${slug}`, label: t(`policy.link.${slug}`) }]
      : [],
  );
  return { clothingTypes, support: supportLinks(supportFrom(config)), policies };
});
