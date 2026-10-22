import localFont from 'next/font/local';

/*
 * Self-hosted, subsetted WOFF2 (src/fonts). Only the weights the design uses are shipped.
 *  - Drafting Mono (SIL OFL 1.1): brand typeface. Has NO glyph for the Naira sign, dotted Yoruba
 *    letters or arrows (checked with fontTools).
 *  - Inter (SIL OFL 1.1): fallback and long-text font; verified to contain U+20A6, U+1EB9,
 *    U+1ECD, U+1E63 and U+2192.
 * Licences sit next to the files.
 */
export const drafting = localFont({
  src: [
    { path: '../fonts/DraftingMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/DraftingMono-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/DraftingMono-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-drafting',
  display: 'swap',
  preload: true,
  fallback: ['ui-monospace', 'monospace'],
});

export const inter = localFont({
  src: [
    { path: '../fonts/Inter-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Inter-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Inter-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});
