import type { PublicProductDetailDto } from '@urban-ibile/shared';
import { describe, expect, it } from 'vitest';
import { jsonLdScript, productJsonLd } from './structured-data';

const product: PublicProductDetailDto = {
  id: '1',
  slug: 'indigo-kaftan',
  name: 'Indigo </script><b>',
  clothingType: { slug: 'shirt', name: 'Shirt' },
  priceMinor: 3_500_000,
  currency: 'NGN',
  inStock: false,
  media: null,
  image: null,
  description: null,
  videos: [],
  images: [],
  sizes: [],
  blueprint: { required: false, profile: null },
};

describe('productJsonLd', () => {
  it('states price in NGN major units and availability', () => {
    const offers = productJsonLd(product).offers as Record<string, string>;
    expect(offers.price).toBe('35000.00');
    expect(offers.priceCurrency).toBe('NGN');
    expect(offers.availability).toBe('https://schema.org/OutOfStock');
  });
  it('cannot be broken out of the script tag', () => {
    expect(jsonLdScript(productJsonLd(product))).not.toContain('</script>');
  });
});
