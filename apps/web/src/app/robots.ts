import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/config/env';

export default function robots(): MetadataRoute.Robots {
  return {
    // Search result pages are noindex; hidden pages are not linked or listed anywhere.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/search'] }],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
