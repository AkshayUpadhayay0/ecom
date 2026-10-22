import type { Locale } from '@urban-ibile/i18n';
import type { PublicProductCardDto } from '@urban-ibile/shared';
import { ProductCard } from './product-card';

/** Cards above the fold load their poster eagerly (LCP); later ones are lazy. */
const EAGER_POSTERS = 2;

export function ProductGrid({
  products,
  locale,
  label,
  eagerPosters = true,
}: {
  products: PublicProductCardDto[];
  locale: Locale;
  label: string;
  eagerPosters?: boolean;
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4"
    >
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            locale={locale}
            priority={eagerPosters && index < EAGER_POSTERS}
          />
        </li>
      ))}
    </ul>
  );
}
