import type { PublicImageDto } from '@urban-ibile/shared';
import ReactDOM from 'react-dom';
import { isMediaUrlAllowed } from '@/config/media-env';

type Rendition = PublicImageDto['variants'][number];

interface Props {
  src: string;
  alt: string;
  sizes: string;
  /** Pre-generated renditions of the same picture; the browser picks one from `sizes`. */
  variants?: readonly Rendition[] | undefined;
  priority?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
  className?: string;
}

/** `url 320w, url 640w, ...` from renditions that report a width. */
export function srcSetOf(variants: readonly Rendition[]): string | undefined {
  const sized = variants.filter((v) => (v.width ?? 0) > 0);
  if (sized.length < 2) return undefined;
  return sized.map((v) => `${v.url} ${v.width}w`).join(', ');
}

/**
 * Product media picture. UNOPTIMISED on purpose: the media pipeline already produced sized WebP
 * renditions (w320/w640/w1280) that sit on the CDN, so next/image's optimiser (a server resize per
 * width and format) would only repeat that work on our web servers. The component fills its
 * positioned parent like next/image `fill`, so layout, aspect ratio and the dominant-colour
 * background of the parent are unchanged. A URL outside the configured media host and path is
 * never rendered.
 */
export function MediaImage({
  src,
  alt,
  sizes,
  variants,
  priority = false,
  fetchPriority,
  className,
}: Props) {
  if (!isMediaUrlAllowed(src)) return null;
  const allowed = (variants ?? []).filter((v) => isMediaUrlAllowed(v.url));
  const srcSet = srcSetOf(allowed);

  if (priority) {
    // Same as next/image `priority`: start the download before hydration (LCP image).
    ReactDOM.preload(src, {
      as: 'image',
      fetchPriority: fetchPriority ?? 'high',
      ...(srcSet ? { imageSrcSet: srcSet, imageSizes: sizes } : {}),
    });
  }

  return (
    // Plain img on purpose: renditions are pre-generated, see above.
    <img
      src={src}
      {...(srcSet ? { srcSet, sizes } : {})}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(fetchPriority || priority ? { fetchPriority: fetchPriority ?? 'high' } : {})}
      className={`absolute inset-0 h-full w-full ${className ?? ''}`.trim()}
    />
  );
}
