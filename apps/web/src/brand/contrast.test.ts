import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COLORS,
  CSS_VARIABLES,
  LIGHT_BACKGROUNDS,
  NEVER_TEXT_ON_LIGHT,
  USED_PAIRS,
  type ColorName,
} from './tokens';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

describe('colour tokens', () => {
  it.each(
    USED_PAIRS.map(
      (p) => [`${p.foreground} on ${p.background} (${p.size}): ${p.usage}`, p] as const,
    ),
  )('%s meets WCAG AA', (_label, pair) => {
    const ratio = contrast(COLORS[pair.foreground], COLORS[pair.background]);
    expect(ratio).toBeGreaterThanOrEqual(pair.size === 'large' ? AA_LARGE : AA_NORMAL);
  });

  it('never uses Marigold as text on a light background', () => {
    const offenders = USED_PAIRS.filter(
      (p) => NEVER_TEXT_ON_LIGHT.includes(p.foreground) && LIGHT_BACKGROUNDS.includes(p.background),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps tokens.css identical to tokens.ts', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/brand/tokens.css'), 'utf8');
    for (const name of Object.keys(COLORS) as ColorName[]) {
      const variable = CSS_VARIABLES[name];
      const match = new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(match?.[1]?.toLowerCase(), variable).toBe(COLORS[name].toLowerCase());
    }
  });
});
