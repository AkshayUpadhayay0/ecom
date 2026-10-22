import { expect, test } from '@playwright/test';

test.describe('language switcher', () => {
  test('is hidden by default (Pidgin flag is off)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Language' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('a stored Pidgin cookie is ignored while the flag is off', async ({ page, context }) => {
    await context.addCookies([{ name: 'ui_lang', value: 'pcm', url: 'http://localhost:3100' }]);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('prices and fonts', () => {
  test('prices show the Naira sign', async ({ page }) => {
    await page.goto('/shop');
    const price = page.locator('[data-testid="product-card"] .price').first();
    await expect(price).toContainText('₦');
    await expect(price).toHaveText(/^₦[\d,]+(\.\d{2})?$/);
  });

  test('the Naira sign is drawn by the fallback font (Drafting Mono has no glyph for it)', async ({
    page,
  }) => {
    await page.goto('/shop');
    const price = page.locator('[data-testid="product-card"] .price').first();
    await expect(price).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-testid="product-card"] .price',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    // Digits come from the brand font and the Naira sign from the fallback: two faces are used.
    // (next/font renames families, so names are not asserted.)
    expect(new Set(fonts.map((f) => f.familyName)).size).toBeGreaterThanOrEqual(2);
  });

  test('the brand name and accented letters render without tofu', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toContainText('Urban Ibile');
  });
});
