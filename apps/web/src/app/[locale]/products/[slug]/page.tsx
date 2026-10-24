import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { PurchasePanel } from '@/components/blueprint/purchase-panel';
import { ProductPlayer } from '@/components/product-player';
import { getProduct, getSiteConfig, maxQuantityFrom, supportFrom } from '@/lib/api/public';
import { formatPrice } from '@/lib/format/price';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import { jsonLdScript, productImageUrls, productJsonLd } from '@/lib/structured-data';

// Next reads this export statically, so it must be a literal (60 s, as CATALOG_REVALIDATE_SECONDS).
export const revalidate = 60;
// Product pages are generated on first visit, then refreshed at most every 60 s.
export const dynamicParams = true; // slugs are rendered on first visit
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

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
  const [product, config] = await Promise.all([
    getProduct(slug),
    getSiteConfig().catch(() => null),
  ]);
  if (!product) notFound();

  const video = product.videos[0] ?? null;

  return (
    <article className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product)) }}
      />
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          {video ? <ProductPlayer video={video} name={product.name} /> : null}
          {product.images.length > 0 ? (
            <ul
              aria-label={t('product.gallery')}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
            >
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
          <p className="text-sm text-ink-muted">
            {product.clothingType.name ?? product.clothingType.slug}
          </p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{product.name}</h1>
          <p className="price mt-3 text-2xl font-semibold">
            {formatPrice(product.priceMinor, product.currency)}
          </p>
          {!product.inStock ? (
            <p className="mt-3 w-fit bg-ink px-2 py-0.5 text-sm text-ivory">
              {t('product.out_of_stock')}
            </p>
          ) : null}

          {product.description ? (
            <section aria-labelledby="desc" className="mt-8">
              <h2 id="desc" className="text-lg font-semibold">
                {t('product.description')}
              </h2>
              <p className="prose-body mt-2 whitespace-pre-line">{product.description}</p>
            </section>
          ) : null}

          <div className="mt-8">
            <PurchasePanel
              productId={product.id}
              slug={product.slug}
              sizes={product.sizes}
              blueprintRequired={product.blueprint.required}
              maxQuantity={maxQuantityFrom(config)}
              support={supportFrom(config)}
            />
          </div>
          {product.blueprint.required && product.blueprint.profile ? (
            <section aria-label="Blueprint" className="mt-8 border-l-4 border-emerald pl-4">
              <p>{t('product.blueprint_applies')}</p>
              <p className="mt-2 text-sm text-ink-muted">
                {t('product.blueprint_measurements')}:{' '}
                {product.blueprint.profile.measurements.map((m) => m.label).join(', ')}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}
