import type { Locale } from '@urban-ibile/i18n';
import type { PublicProductCardDto } from '@urban-ibile/shared';
import Link from 'next/link';
import { formatPrice } from '@/lib/format/price';
import { getTranslator } from '@/lib/i18n/server';
import { MediaFrame } from './media-frame';

const CARD_SIZES = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw';

/**
 * Product card. The name is the (stretched) link, so the play button on the media can sit above
 * it without nesting interactive elements. Names are never translated.
 */
export function ProductCard({
  product,
  locale,
  priority = false,
  headingLevel = 'h3',
}: {
  product: PublicProductCardDto;
  locale: Locale;
  priority?: boolean;
  /** Heading level of the product name: h2 under a page h1, h3 under a section h2. */
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const t = getTranslator(locale);
  return (
    <article className="group relative flex flex-col" data-testid="product-card">
      <MediaFrame
        media={product.media}
        image={product.image}
        priority={priority}
        sizes={CARD_SIZES}
      />
      <div className="mt-3 flex flex-1 flex-col gap-1">
        <Heading className="text-base font-medium leading-snug">
          <Link
            href={`/products/${product.slug}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-4"
          >
            {product.name}
          </Link>
        </Heading>
        <p className="price text-base font-semibold">
          {formatPrice(product.priceMinor, product.currency)}
        </p>
        {!product.inStock ? (
          <p className="mt-1 w-fit bg-ink px-2 py-0.5 text-sm text-ivory">
            {t('product.out_of_stock')}
          </p>
        ) : null}
      </div>
    </article>
  );
}
