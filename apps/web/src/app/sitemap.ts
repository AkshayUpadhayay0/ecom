import type { MetadataRoute } from 'next';
import { SITEMAP_PAGE_SIZE } from '@/config/constants';
import { siteOrigin } from '@/config/env';
import { getProducts } from '@/lib/api/public';

/** Regenerated hourly. Products come from the catalogue API; hidden pages are never listed. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const entries: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/shop`, changeFrequency: 'daily', priority: 0.9 },
  ];

  try {
    let page = 1;
    let totalPages = 1;
    do {
      const list = await getProducts({ page, pageSize: SITEMAP_PAGE_SIZE });
      for (const product of list.data) {
        entries.push({
          url: `${origin}/products/${product.slug}`,
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
      totalPages = list.meta.totalPages;
      page += 1;
    } while (page <= totalPages);
  } catch {
    // API unavailable at build/refresh time: ship the static entries rather than failing.
  }
  return entries;
}
