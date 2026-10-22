import type { SizeAvailability } from '@urban-ibile/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { ProductPlayer } from '@/components/product-player';
import { PAGE_REVALIDATE_SECONDS } from '@/config/constants';
import { getProduct } from '@/lib/api/public';
import { formatPrice } from '@/lib/format/price';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import { jsonLdScript, productImageUrls, productJsonLd } from '@/lib/structured-data';

export const revalidate = PAGE_REVALIDATE_SECONDS;
// Product pages are generated on first visit, then refreshed at most every 60 s.
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

const SIZE_LABEL_KEY = {
  in_stock: 'size.in_stock',
  low_stock: 'size.low_stock',
  out_of_stock: 'size.out_of_stock',
} as const satisfies Record<SizeAvailability, string>;

const DESCRIPTION_LIMIT = 160;
const IMAGE_SIZES = '(min-width: 1024px) 45vw, 100vw';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: 'Not found', robots: { index: false } };
  const images = productImageUrls(product);
  const description = product.description?.slice(0, DESCRIPTION_LIMIT);
  return {
    title: product.name,
    ...(description ? { description } : {}),
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      ...(description ? { description } : {}),
      type: 'website',
      ...(images[0] ? { images: [{ url: images[0] }] } : {}),
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { locale: rawLocale, slug } = await params;
  const locale = toLocale(rawLocale);
  const t = getTranslator(locale);
  const product = await getProduct(slug);
  if (!product) notFound();

  const video = product.videos[0] ?? null;

  return (
    <article className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product)) }} />
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          {video ? <ProductPlayer video={video} name={product.name} /> : null}
          {product.images.length > 0 ? (
            <ul aria-label={t('product.gallery')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {product.images.map((image, index) => {
                const src = image.variants[image.variants.length - 1];
                if (!src) return null;
                return (
                  <li
                    key={src.url}
                    className="relative aspect-[4/5] overflow-hidden"
                    style={{ backgroundColor: image.dominantColor ?? 'var(--ui-line)' }}
                  >
                    <Image
                      src={src.url}
                      alt={`${product.name} (${index + 1})`}
                      fill
                      sizes={IMAGE_SIZES}
                      priority={!video && index === 0}
                      className="object-cover"
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {!video && product.images.length === 0 ? (
            <div className="aspect-[4/5] bg-line" role="img" aria-label={product.name} />
          ) : null}
        </div>

        <div>
          <p className="text-sm text-ink-muted">{product.clothingType.name ?? product.clothingType.slug}</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{product.name}</h1>
          <p className="price mt-3 text-2xl font-semibold">{formatPrice(product.priceMinor, product.currency)}</p>
          {!product.inStock ? (
            <p className="mt-3 w-fit bg-ink px-2 py-0.5 text-sm text-ivory">{t('product.out_of_stock')}</p>
          ) : null}

          {product.description ? (
            <section aria-labelledby="desc" className="mt-8">
              <h2 id="desc" className="text-lg font-semibold">
                {t('product.description')}
              </h2>
              <p className="prose-body mt-2 whitespace-pre-line">{product.description}</p>
            </section>
          ) : null}

          <section aria-labelledby="sizes" className="mt-8">
            <h2 id="sizes" className="text-lg font-semibold">
              {t('product.sizes')}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {product.sizes.map((size) => (
                <li
                  key={size.sizeCode}
                  className={`border px-3 py-2 text-sm ${
                    size.availability === 'out_of_stock' ? 'border-line text-ink-muted' : 'border-ink'
                  }`}
                >
                  <span className="font-semibold">{size.sizeCode}</span>
                  <span className="sr-only"> ({size.label}): </span>
                  <span className="ml-2 text-ink-muted">{t(SIZE_LABEL_KEY[size.availability])}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Blueprint" className="mt-8 border-l-4 border-emerald pl-4">
            {product.blueprint.required && product.blueprint.profile ? (
              <>
                <p>{t('product.blueprint_applies')}</p>
                <p className="mt-2 text-sm text-ink-muted">
                  {t('product.blueprint_measurements')}:{' '}
                  {product.blueprint.profile.measurements.map((m) => m.label).join(', ')}
                </p>
              </>
            ) : (
              <p>{t('product.blueprint_none')}</p>
            )}
          </section>

          {/*
            W2/W3 EXTENSION POINT: "Find My Size" (Blueprint, W2) and "Add to cart" (W3) belong here,
            between the Blueprint note above and the end of this column. Both need a signed-in
            customer, so no buttons are rendered in W1.
          */}
        </div>
      </div>
    </article>
  );
}
