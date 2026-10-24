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

  test('uses the supplied logo files and the generated icon set', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('header img[src="/brand/wordmark-ink-black.svg"]')).toBeVisible();
    await expect(page.locator('footer img[src="/brand/seal-warm-ivory.svg"]')).toBeVisible();
    const icons = await page
      .locator('head link[rel~="icon"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(icons.some((href) => href.includes('icon.svg'))).toBe(true);
    expect(icons.some((href) => href.includes('favicon.ico'))).toBe(true);
    await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('head link[rel="manifest"]')).toHaveCount(1);

    for (const path of [
      '/favicon.ico',
      '/icon.svg',
      '/apple-icon.png',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
    ]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      icons: { src: string }[];
    };
    expect(manifest.icons).toHaveLength(3);
  });
});

test.describe('brand name', () => {
  test('displays the diacritic spelling while metadata keeps the plain one', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Urban \u00ccb\u00edl\u00e9');
    await expect(
      page.getByRole('link', { name: 'Urban \u00ccb\u00edl\u00e9, home' }),
    ).toBeVisible();
    await expect(page.locator('footer')).toContainText('Urban \u00ccb\u00edl\u00e9');
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      'content',
      'Urban Ibile',
    );
    const keywords = (await page.locator('meta[name="keywords"]').getAttribute('content')) ?? '';
    expect(keywords).toContain('Urban Ibile');
    expect(keywords).toContain('Urban \u00ccb\u00edl\u00e9');
    // URLs stay ASCII.
    expect(page.url()).toMatch(/^[\x20-\x7e]+$/);
    expect((await request.get('/robots.txt')).status()).toBe(200);
  });

  test('the accented letters are drawn by Drafting Mono itself (no fallback font needed)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.id = 'glyph-probe';
      holder.innerHTML =
        '<h1 id="probe-h1" class="font-display">Urban \u00ccb\u00edl\u00e9</h1>' +
        '<p id="probe-p" class="font-display font-medium">\u00a9 2026 Urban \u00ccb\u00edl\u00e9</p>';
      document.body.append(holder);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    for (const selector of ['#probe-h1', '#probe-p', 'footer .border-t p']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const families = new Set(fonts.map((font) => font.familyName));
      expect(families.size, `${selector} uses one face: ${[...families].join(', ')}`).toBe(1);
    }
  });
});
