import type { PublicProductDetailDto } from '@urban-ibile/shared';
import { BRAND_NAME } from '@/brand/brand';
import { siteOrigin } from '@/config/env';
import { majorUnitsString } from '@/lib/format/price';

export function productImageUrls(product: PublicProductDetailDto): string[] {
  const urls: string[] = [];
  for (const video of product.videos) if (video.posterUrl) urls.push(video.posterUrl);
  for (const image of product.images) {
    const largest = image.variants[image.variants.length - 1];
    if (largest) urls.push(largest.url);
  }
  return urls;
}

/** schema.org Product with price (major units from integers) and availability. */
export function productJsonLd(product: PublicProductDetailDto): Record<string, unknown> {
  const images = productImageUrls(product);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    brand: { '@type': 'Brand', name: BRAND_NAME },
    category: product.clothingType.name ?? product.clothingType.slug,
    offers: {
      '@type': 'Offer',
      url: `${siteOrigin()}/products/${product.slug}`,
      price: majorUnitsString(product.priceMinor),
      priceCurrency: product.currency,
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };
}

/** JSON for an inline <script>: "<" is escaped so product text can never close the tag. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
