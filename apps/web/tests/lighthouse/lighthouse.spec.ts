import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { SEEDED } from '../e2e/helpers';

/*
 * Lighthouse (mobile preset, simulated slow 4G) against the seeded e2e stack. Targets from the
 * brief: accessibility 100, performance 85 or above. NOTE: the e2e media is tiny generated test
 * media, so these numbers are optimistic for performance: real media must be checked too.
 */
const MIN_PERFORMANCE = 0.85;
const MIN_ACCESSIBILITY = 1;
const LIGHTHOUSE_VERSION = '12';

const PAGES = [
  ['home', '/'],
  ['shop', '/shop'],
  ['search results', '/search?q=zanzibar'],
  ['product with video', `/products/${SEEDED.withVideo}`],
  ['product without video', `/products/${SEEDED.noVideo}`],
] as const;

interface Report {
  categories: { performance: { score: number }; accessibility: { score: number } };
  audits: Record<string, { numericValue?: number; displayValue?: string }>;
}

function audit(url: string, name: string): Report {
  const folder = mkdtempSync(join(tmpdir(), 'lh-'));
  const out = join(folder, 'report.json');
  execFileSync(
    'npx',
    [
      '--yes',
      `lighthouse@${LIGHTHOUSE_VERSION}`,
      url,
      '--output=json',
      `--output-path=${out}`,
      '--only-categories=performance,accessibility',
      '--chrome-flags=--headless=new --no-sandbox',
      '--quiet',
    ],
    {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
    },
  );
  // Keep the full report for inspection (test-results is git-ignored).
  mkdirSync('test-results/lighthouse', { recursive: true });
  copyFileSync(out, `test-results/lighthouse/${name.replace(/\s+/g, '-')}.json`);
  return JSON.parse(readFileSync(out, 'utf8')) as Report;
}

test.setTimeout(600_000);

for (const [name, path] of PAGES) {
  test(`lighthouse mobile: ${name}`, ({ baseURL }) => {
    const report = audit(`${baseURL}${path}`, name);
    const performance = report.categories.performance.score;
    const accessibility = report.categories.accessibility.score;
    const metric = (id: string) => report.audits[id]?.displayValue ?? 'n/a';
    // eslint-disable-next-line no-console -- the numbers are the point of this run
    console.log(
      `LIGHTHOUSE ${name}: performance ${Math.round(performance * 100)}, accessibility ${Math.round(accessibility * 100)}, LCP ${metric('largest-contentful-paint')}, TBT ${metric('total-blocking-time')}, CLS ${metric('cumulative-layout-shift')}`,
    );
    expect(accessibility).toBeGreaterThanOrEqual(MIN_ACCESSIBILITY);
    expect(performance).toBeGreaterThanOrEqual(MIN_PERFORMANCE);
  });
}
