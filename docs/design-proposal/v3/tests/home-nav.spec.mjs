// Stage 2: home and navigation. Real assertions (no screenshots).
import AxeBuilder from '../../../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const NO_RESULTS = 'No outfits found. Try another word.';
const BRAND = 'Urban Ìbílé';

async function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test.describe('home', () => {
  test('has the hero, one band, category tiles, a carousel and one closing button', async ({ page }) => {
    const errors = await collectErrors(page);
    await page.goto('/index.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(BRAND);
    const shop = page.getByRole('link', { name: 'Shop', exact: true }).first();
    await expect(shop).toBeVisible();
    await expect(page.locator('.band')).toHaveCount(1);
    await expect(page.locator('.tiles li')).toHaveCount(5);
    await expect(page.getByRole('region', { name: 'New outfits' }).locator('article')).toHaveCount(8);
    await expect(page.getByRole('link', { name: 'See every outfit' })).toBeVisible();
    // No About, no newsletter, no filler.
    await expect(page.getByText(/about us|newsletter|subscribe/i)).toHaveCount(0);
    await expect(page.locator('footer')).toContainText(`© 2026 ${BRAND}`);
    expect(errors).toEqual([]);
  });

  test('is marked noindex and the host is told not to index it', async ({ page, request }) => {
    await page.goto('/index.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /');
    expect((await request.get('/index.html')).headers()['x-robots-tag']).toContain('noindex');
  });

  test('every sample video frame carries the small "Sample" tag', async ({ page }) => {
    await page.goto('/index.html');
    const frames = await page.locator('.vframe').count();
    expect(frames).toBeGreaterThan(3);
    expect(await page.locator('.vframe .sample').count()).toBe(frames);
  });

  test('the carousel moves with its arrows and with the keyboard', async ({ page }) => {
    await page.goto('/index.html');
    const track = page.getByRole('region', { name: 'New outfits' });
    await track.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Next outfits' }).click();
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await track.focus();
    const before = await track.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeLessThan(before);
  });
});

test.describe('header', () => {
  test('is transparent over the hero and solid after it', async ({ page }) => {
    await page.goto('/index.html');
    const header = page.locator('#site-header');
    await expect(header).toHaveAttribute('data-state', 'over-hero');
    await expect(page.locator('.logo-hero')).toBeVisible();
    await page.mouse.wheel(0, 1500);
    await expect(header).toHaveAttribute('data-state', 'solid');
    await expect(page.locator('.logo-solid')).toBeVisible();
  });

  test('has the menu on the left, the wordmark in the middle, search, account and cart on the right', async ({ page }) => {
    await page.goto('/index.html#/shop');
    const box = async (loc) => loc.boundingBox();
    const menu = await box(page.getByRole('button', { name: 'Open menu' }));
    const logo = await box(page.getByRole('link', { name: `${BRAND}, home` }));
    const search = await box(page.getByRole('button', { name: 'Open search' }));
    const account = await box(page.getByRole('link', { name: 'Sign in' }));
    const cart = await box(page.getByRole('button', { name: 'Open cart' }));
    const w = page.viewportSize().width;
    expect(menu.x).toBeLessThan(logo.x);
    expect(Math.abs(logo.x + logo.width / 2 - w / 2)).toBeLessThan(10);
    expect(search.x).toBeGreaterThan(logo.x);
    expect(account.x).toBeGreaterThan(search.x);
    expect(cart.x).toBeGreaterThan(account.x);
  });
});

test.describe('side menu', () => {
  test('slides in from the left at full height, lists the types, and Esc returns focus', async ({ page }) => {
    await page.goto('/index.html');
    const opener = page.getByRole('button', { name: 'Open menu' });
    await opener.click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await expect(async () => {
      const b = await menu.boundingBox();
      expect(b.x).toBe(0);
      expect(b.height).toBe(page.viewportSize().height);
    }).toPass();
    await expect(menu.getByRole('link', { name: '[Blazer]' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('keeps keyboard focus inside while open and a type link goes to the shop', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      const escaped = await menu.evaluate((d) => {
        const a = document.activeElement;
        return !d.contains(a) && a !== document.body && a !== null;
      });
      expect(escaped).toBe(false);
    }
    await menu.getByRole('link', { name: '[Suit]' }).click();
    await expect(page).toHaveURL(/#\/shop\?type=suit$/);
    await expect(menu).toBeHidden();
  });
});

test.describe('search', () => {
  test('suggests types and outfits while typing, and Enter opens the results route', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Open search' }).click();
    const box = page.getByRole('combobox', { name: 'Search outfits' });
    await expect(box).toBeFocused();
    await box.fill('blaz');
    const options = page.getByRole('option');
    await expect(options.first()).toContainText('Shop [Blazer]');
    await expect(page.getByRole('option', { name: /\[Sample outfit 03\]/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/#\/search\?q=blaz$/);
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
  });

  test('arrow keys pick a suggestion', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Open search' }).click();
    const box = page.getByRole('combobox', { name: 'Search outfits' });
    await box.fill('blaz');
    await box.press('ArrowDown');
    await box.press('ArrowDown');
    await expect(page.getByRole('option', { selected: true })).toContainText('[Sample outfit 03]');
    await box.press('Enter');
    await expect(page).toHaveURL(/#\/product\/sample-outfit-03$/);
  });

  test('a word that matches nothing shows the exact message', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox', { name: 'Search outfits' }).fill('zzzz');
    await expect(page.getByText(NO_RESULTS, { exact: true })).toBeVisible();
  });

  test('Esc closes it (even with text in the box) and focus returns to the search button', async ({ page }) => {
    await page.goto('/index.html');
    const opener = page.getByRole('button', { name: 'Open search' });
    await opener.click();
    await page.getByRole('combobox', { name: 'Search outfits' }).fill('abc');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('cart drawer', () => {
  test('changes quantity, shows the subtotal, removes the line and shows the empty state', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('[data-cart-count]')).toHaveText('1');
    await page.getByRole('button', { name: 'Open cart' }).click();
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toContainText('[Sample outfit 01]');
    await expect(drawer).toContainText('Recommended for your measurements');
    await drawer.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(drawer.getByText('96,000', { exact: false }).first()).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('2');
    await drawer.getByRole('button', { name: 'Remove' }).click();
    await expect(drawer.getByText('Your cart is empty.')).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('0');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});

test.describe('video rules', () => {
  test('the hero starts playing and no more than the desktop limit (4) play at once', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await expect(page.locator('.hero video').first()).toBeAttached();
    await expect.poll(() => page.evaluate(() => PROTO_VIDEO.playing())).toBeGreaterThan(0);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => PROTO_VIDEO.playing())).toBeLessThanOrEqual(4);
      expect(await page.locator('video').count()).toBeLessThanOrEqual(6);
    }
  });

  test('on a phone no more than 2 grid clips play at once, and the hero is the only one in the hero slot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');
    await expect.poll(() => page.evaluate(() => PROTO_VIDEO.playing())).toBeGreaterThan(0);
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => PROTO_VIDEO.playing())).toBeLessThanOrEqual(3); // 2 grid + 1 hero slot
      expect(await page.locator('.hero video.on, .band video').count()).toBeLessThanOrEqual(2);
    }
  });

  test('the runway hero cross-fades instead of jumping when the clip ends', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    const layer = page.locator('.hero .layer');
    await expect(layer.locator('video')).toHaveCount(2);
    const seen = new Set();
    const started = Date.now();
    while (Date.now() - started < 11000) {
      const on = await layer.locator('video').evaluateAll((vs) => vs.map((v) => v.classList.contains('on')));
      expect(on.some(Boolean)).toBe(true); // never blank
      on.forEach((flag, i) => flag && seen.add(i));
      await page.waitForTimeout(100);
    }
    expect(seen.size).toBe(2);
  });

  test('Save-Data / slow mode (?savedata=1): posters only, play on tap, no drift', async ({ page }) => {
    await page.goto('/index.html?savedata=1');
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
    expect(await page.locator('video').count()).toBe(0);
    expect(await page.evaluate(() => PROTO_VIDEO.playing())).toBe(0);
    await expect(page.locator('.hero .playbtn')).toBeVisible();
    expect(await page.locator('.hero .layer').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await page.mouse.wheel(0, -900);
    await page.locator('.hero .playbtn').click();
    await expect(page.locator('.hero video').first()).toBeAttached();
    await expect(page.locator('.hero .playbtn')).toHaveAttribute('aria-label', 'Pause video');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('posters with a play button, no autoplay, no drift, no band parallax', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(800);
    expect(await page.locator('video').count()).toBe(0);
    await expect(page.locator('.hero .playbtn')).toBeVisible();
    expect(await page.locator('.hero .layer').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await page.mouse.wheel(0, 1100);
    await page.waitForTimeout(400);
    const transform = await page.locator('[data-parallax]').evaluate((el) => el.style.transform);
    expect(transform).toBe('');
  });
});

test.describe('keyboard and accessibility', () => {
  test('the skip link is the first tab stop and lands on main', async ({ page }) => {
    await page.goto('/index.html');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  for (const [name, setup] of [
    ['home', async () => {}],
    ['open menu', async (page) => { await page.getByRole('button', { name: 'Open menu' }).click(); }],
    ['open search with suggestions', async (page) => { await page.getByRole('button', { name: 'Open search' }).click(); await page.getByRole('combobox').fill('blaz'); }],
    ['open cart', async (page) => { await page.getByRole('button', { name: 'Open cart' }).click(); }],
    ['open guide', async (page) => { await page.getByRole('button', { name: 'Prototype guide' }).click(); }],
  ]) {
    test(`axe: ${name} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto('/index.html');
      await setup(page);
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
