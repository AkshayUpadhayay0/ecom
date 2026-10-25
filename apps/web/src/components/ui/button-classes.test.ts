import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { primaryButtonClass } from './button-classes';

/** White on brand Red is 4.04:1: AA only for large text (18.66 px bold or larger). */
const MIN_LARGE_BOLD_REM = 18.66 / 16;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('primary button (brand Red, white text)', () => {
  it('is bold and at least 19 px, so white on Red passes as large text', () => {
    const size = /text-\[([\d.]+)rem\]/.exec(primaryButtonClass);
    expect(size, 'explicit rem text size').not.toBeNull();
    expect(Number(size?.[1])).toBeGreaterThanOrEqual(MIN_LARGE_BOLD_REM);
    expect(primaryButtonClass).toContain('font-bold');
    expect(primaryButtonClass).toContain('bg-red');
    expect(primaryButtonClass).toContain('text-white');
  });

  it('no component paints Red behind small text on its own', () => {
    const root = resolve(process.cwd(), 'src');
    const offenders = sourceFiles(root).filter((file) => {
      const text = readFileSync(file, 'utf8');
      if (!/\bbg-red\b/.test(text)) return false;
      // Allowed: the shared primary class, or an explicit large bold size next to it.
      return !/primaryButtonClass|text-\[1\.1875rem\]|text-(2xl|3xl|4xl)/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
