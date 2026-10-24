/**
 * The client's supplied logo files, used unmodified (never stretched, recoloured or redrawn):
 *  - wordmark (Ink Black)  header, on the Warm Ivory page
 *  - seal (Warm Ivory)     footer, on the Emerald Forest block
 * The icon (Red) is the favicon / app icon (src/app/icon.svg and the generated PNGs).
 *
 * Both are decorative here: the link or text around them already carries the brand name, so the
 * images have an empty alt (a screen reader hears the link label, not the file).
 */
const LOGOS = {
  wordmark: { src: '/brand/wordmark-ink-black.svg', width: 250, height: 35 },
  seal: { src: '/brand/seal-warm-ivory.svg', width: 150, height: 150 },
} as const;

export type LogoVariant = keyof typeof LOGOS;

export function BrandLogo({
  variant = 'wordmark',
  className = '',
}: {
  variant?: LogoVariant;
  className?: string;
}) {
  const logo = LOGOS[variant];
  return (
    // SVG files are served as they are (no image optimiser): next/image would rewrite them.
    <img src={logo.src} width={logo.width} height={logo.height} alt="" className={className} />
  );
}
