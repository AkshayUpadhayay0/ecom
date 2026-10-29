import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PurchasePanel } from '@/components/blueprint/purchase-panel';
import { ProductMedia } from '@/components/product-media';
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
      <div className="grid gap-10 lg:grid-cols-[var(--product-media-width)_1fr]">
        {/* Sticky while the details scroll; sizes live in globals.css (.product-media-stage). */}
        <div className="lg:sticky lg:top-[calc(var(--ui-header-h)+1rem)] lg:self-start">
          <ProductMedia video={video} images={product.images} name={product.name} />
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
