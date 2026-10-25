import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SEEDED } from './helpers';

const PAGES = [
  ['home', '/'],
  ['shop', '/shop'],
  ['shop page 2 with filter', '/shop?page=2&sort=price_asc'],
  ['search results', '/search?q=zanzibar'],
  ['search empty', '/search?q=qzxqzxqzx'],
  ['product with video', `/products/${SEEDED.withVideo}`],
  ['product without video', `/products/${SEEDED.noVideo}`],
  ['not found', '/products/nope-nope'],
] as const;

for (const [name, path] of PAGES) {
  test(`axe: ${name} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  });
}

test('skip link is the first tab stop and lands on main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('axe: the open side menu and the open search overlay have no WCAG A/AA violations', async ({
  page,
}) => {
  await page.goto('/shop');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
  let results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
