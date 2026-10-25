/**
 * Design tokens in TypeScript (colour contrast tests, JSON-LD, anything that needs the hex).
 * Keep identical to tokens.css: tokens.test.ts fails when they drift apart.
 */
export const BRAND_COLORS = {
  red: '#F5262D',
  emerald: '#174C3C',
  marigold: '#F2B544',
  terracotta: '#C95D43',
  white: '#FFFFFF',
  ivory: '#FFFCEB',
  ink: '#171717',
} as const;

/** DERIVED, PENDING CLIENT APPROVAL (Technical Recommendation). */
export const DERIVED_COLORS = {
  redText: '#E12329',
  terracottaText: '#BB563E',
  inkMuted: '#5C5B57',
} as const;

export const COLORS = { ...BRAND_COLORS, ...DERIVED_COLORS } as const;
export type ColorName = keyof typeof COLORS;

/** CSS variable name for each colour (tokens.css). */
export const CSS_VARIABLES: Record<ColorName, string> = {
  red: '--ui-red',
  emerald: '--ui-emerald',
  marigold: '--ui-marigold',
  terracotta: '--ui-terracotta',
  white: '--ui-white',
  ivory: '--ui-ivory',
  ink: '--ui-ink',
  redText: '--ui-red-text',
  terracottaText: '--ui-terracotta-text',
  inkMuted: '--ui-ink-muted',
};

export type TextSize = 'normal' | 'large';

export interface ColorPair {
  foreground: ColorName;
  background: ColorName;
  /** normal = below 24px (or 18.66px bold); large = at or above. */
  size: TextSize;
  usage: string;
}

/**
 * Every foreground/background pair the UI actually uses. contrast.test.ts checks each against
 * WCAG AA (4.5:1 normal, 3:1 large text and graphics). Add a pair here when a new one is used.
 */
export const USED_PAIRS: readonly ColorPair[] = [
  { foreground: 'ink', background: 'ivory', size: 'normal', usage: 'body text on page' },
  { foreground: 'ink', background: 'white', size: 'normal', usage: 'text on cards and inputs' },
  { foreground: 'inkMuted', background: 'ivory', size: 'normal', usage: 'captions and hints' },
  {
    foreground: 'emerald',
    background: 'ivory',
    size: 'normal',
    usage: 'links, headings, focus ring',
  },
  { foreground: 'ivory', background: 'emerald', size: 'normal', usage: 'primary button, footer' },
  { foreground: 'marigold', background: 'emerald', size: 'normal', usage: 'accent on footer' },
  { foreground: 'ink', background: 'marigold', size: 'normal', usage: 'low-stock badge' },
  { foreground: 'marigold', background: 'ink', size: 'normal', usage: 'accent on dark overlay' },
  {
    foreground: 'ivory',
    background: 'ink',
    size: 'normal',
    usage: 'text on video overlay, out-of-stock tag',
  },
  {
    foreground: 'white',
    background: 'red',
    size: 'large',
    usage: 'primary buttons (19px bold or larger)',
  },
  {
    foreground: 'red',
    background: 'ivory',
    size: 'large',
    usage: 'large decorative text and graphics',
  },
  {
    foreground: 'redText',
    background: 'ivory',
    size: 'normal',
    usage: 'errors and small red text',
  },
  { foreground: 'redText', background: 'white', size: 'normal', usage: 'errors on cards' },
  {
    foreground: 'terracottaText',
    background: 'ivory',
    size: 'normal',
    usage: 'small terracotta text',
  },
  {
    foreground: 'terracotta',
    background: 'ivory',
    size: 'large',
    usage: 'large terracotta graphics',
  },
];

/** Colours that must never be text on a light background (contrast 1.8:1). */
export const NEVER_TEXT_ON_LIGHT: readonly ColorName[] = ['marigold'];
export const LIGHT_BACKGROUNDS: readonly ColorName[] = ['ivory', 'white'];
