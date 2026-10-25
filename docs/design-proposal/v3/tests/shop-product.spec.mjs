// Stage 3: shop, search results, quick add, product page.
import AxeBuilder from '../../../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const NO_RESULTS = 'No outfits found. Try another word.';
const cards = (page) => page.locator('main article.card');
const PAGE = 20; // the real shop shows 20 per page
const ofType = (page, type) => page.evaluate((t) => PROTO.PRODUCTS.filter((p) => p.type === t).length, type);
const matching = (page, word) => page.evaluate((w) => PROTO.PRODUCTS.filter((p) => (p.name + ' ' + PROTO.typeOf(p.type).name + ' ' + PROTO.typeOf(p.type).keywords).toLowerCase().replace(/[\[\]]/g, '').includes(w)).length, word);

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('shop', () => {
  test('shows large video-led cards with number, name and price; the sold-out one is marked', async ({ page }) => {
    await page.goto('/index.html#/shop');
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible();
    await expect(cards(page)).toHaveCount(PAGE);
    await expect(cards(page).first()).toContainText('01');
    await expect(cards(page).first()).toContainText('[Sample outfit 01]');
    await expect(cards(page).first()).toContainText('₦ [48,000]');
    const sold = page.locator('article.card.sold');
    await expect(sold).toHaveCount(1);
    await expect(sold).toContainText('Sold out');
    await expect(sold.locator('.quick')).toHaveCount(0);
    expect(await page.locator('main .vframe[data-video]').count()).toBe(PAGE);
  });

  test('clothing type chips filter, and the filter is in the address', async ({ page }) => {
    await page.goto('/index.html#/shop');
    const nav = page.getByRole('navigation', { name: 'Clothing type' });
    await expect(nav.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: '[Blazer]' }).click();
    await expect(page).toHaveURL(/#\/shop\?type=blazer$/);
    await expect(cards(page)).toHaveCount(Math.min(PAGE, await ofType(page, 'blazer')));
    await expect(nav.getByRole('link', { name: '[Blazer]' })).toHaveAttribute('aria-current', 'page');
  });

  test('the sort menu orders the grid and keeps the filter', async ({ page }) => {
    await page.goto('/index.html#/shop');
    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(cards(page).first()).toContainText('₦ [21,000]');
    await page.getByLabel('Sort by').selectOption('price_desc');
    await expect(cards(page).first()).toContainText('₦ [89,000]');
  });

  test('paginates with Previous, Next and numbered pages', async ({ page }) => {
    await page.goto('/index.html#/shop');
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager.getByRole('link', { name: 'Page 2' })).toBeVisible();
    await pager.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);
    const total = await page.evaluate(() => PROTO.PRODUCTS.length);
    await expect(cards(page)).toHaveCount(total - PAGE);
    await expect(pager.locator('[aria-current=page]')).toContainText('2');
    await expect(page.getByText(`Sample catalogue: ${total} outfits, ${PAGE} per page, as in the real shop.`)).toBeVisible();
    await pager.getByRole('link', { name: 'Previous' }).click();
    await expect(cards(page)).toHaveCount(PAGE);
  });

  test('plays no more clips than the limit while scrolling the grid', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html#/shop');
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => PROTO_VIDEO.playing())).toBeLessThanOrEqual(4);
    }
  });

  for (const width of [390, 768, 1440]) {
    test(`has no sideways scrolling at ${width}px (shop, search, product)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of ['#/shop', '#/search?q=blazer', '#/product/sample-outfit-03']) {
        await page.goto(`/index.html${hash}`);
        await page.waitForTimeout(300);
        await noHorizontalOverflow(page);
      }
    });
  }
});

test.describe('quick add', () => {
  test('shows on hover and focus (desktop); a direct-size outfit can be added from the sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html#/shop');
    const card = page.locator('article.card[data-product="p04"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.quick')).toHaveCSS('opacity', '0');
    await card.hover();
    await expect(card.locator('.quick')).toHaveCSS('opacity', '1');
    await card.locator('.quick').click();
    const sheet = page.getByRole('dialog', { name: 'Quick add' });
    await expect(sheet).toContainText('[Sample outfit 04]');
    await sheet.getByRole('button', { name: 'Add to cart' }).click();
    await expect(sheet.getByText('Choose a size to continue.')).toBeVisible();
    await sheet.getByRole('button', { name: /Size L/ }).click();
    await sheet.getByRole('button', { name: 'Add to cart' }).click();
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toContainText('[Sample outfit 04]');
    await expect(drawer).toContainText('Size L');
    await expect(page.locator('[data-cart-count]')).toHaveText('2');
  });

  test('an outfit that needs Find My Size offers it from the sheet instead of a direct size', async ({ page }) => {
    await page.goto('/index.html#/shop');
    await page.locator('article.card[data-product="p03"]').hover();
    await page.locator('article.card[data-product="p03"] .quick').click();
    const sheet = page.getByRole('dialog', { name: 'Quick add' });
    await expect(sheet.getByRole('link', { name: 'Find my size' })).toHaveAttribute('href', '#/fit/sample-outfit-03');
    await expect(sheet.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
  });

  test('is reachable with the keyboard, and Esc returns focus to the button', async ({ page }) => {
    await page.goto('/index.html#/shop');
    const quick = page.locator('article.card[data-product="p04"] .quick');
    await quick.focus();
    await expect(quick).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeHidden();
    await expect(quick).toBeFocused();
  });

  test.describe('on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('the quick-add button is always visible as a small plus', async ({ page }) => {
      await page.goto('/index.html#/shop');
      const quick = page.locator('article.card[data-product="p01"] .quick');
      await expect(quick).toHaveCSS('opacity', '1');
      const box = await quick.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    });
  });
});

test.describe('search results', () => {
  test('match by name and by clothing type', async ({ page }) => {
    await page.goto('/index.html#/search?q=blazer');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('blazer');
    await expect(cards(page)).toHaveCount(Math.min(PAGE, await matching(page, 'blazer')));
    await page.goto('/index.html#/search?q=gown');
    await expect(cards(page)).toHaveCount(Math.min(PAGE, await matching(page, 'gown')));
  });

  test('a word with no match shows the exact message', async ({ page }) => {
    await page.goto('/index.html#/search?q=zzzz');
    await expect(page.getByText(NO_RESULTS, { exact: true })).toBeVisible();
  });

  test('user text is shown as text, never as markup', async ({ page }) => {
    const payload = '<img src=x onerror=alert(1)>';
    let dialog = false;
    page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
    await page.goto(`/index.html#/search?q=${encodeURIComponent(payload)}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(payload);
    expect(dialog).toBe(false);
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
  });

  test('the page search box searches', async ({ page }) => {
    await page.goto('/index.html#/search');
    await page.locator('#page-q').fill('shirt');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/search\?q=shirt$/);
    await expect(cards(page)).toHaveCount(Math.min(PAGE, await matching(page, 'shirt')));
  });
});

test.describe('product page', () => {
  test('puts the video first, with name, price, sizes and the Find My Size block', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html#/product/sample-outfit-03');
    await expect(page.locator('.gallery .vframe[data-video]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[Sample outfit 03]');
    await expect(page.locator('.p-price')).toHaveText('₦ [52,000]');
    await expect(page.getByRole('region', { name: 'Find my size' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find my size' })).toHaveAttribute('href', '#/fit/sample-outfit-03');
    // sizes are listed (read-only) with availability, and Add to cart waits for a size
    await expect(page.locator('.sizes li')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeDisabled();
    await expect(page.getByText('Find your size first to continue.')).toBeVisible();
    // the video is on the left, the details on the right
    const left = await page.locator('.gallery').boundingBox();
    const right = await page.locator('.info').boundingBox();
    expect(left.x).toBeLessThan(right.x);
  });

  test('a direct-size outfit: choose a size, set the quantity, add to cart', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-08');
    await expect(page.getByRole('region', { name: 'Find my size' })).toHaveCount(0);
    const add = page.locator('#add');
    await expect(add).toBeDisabled();
    await expect(page.getByText('Choose a size to continue.')).toBeVisible();
    await page.getByRole('radio', { name: /Size M/ }).click();
    await expect(add).toBeEnabled();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.locator('#qty')).toHaveText('2');
    await add.click();
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toContainText('[Sample outfit 08]');
    await expect(drawer).toContainText('Size M');
    await expect(page.locator('[data-cart-count]')).toHaveText('3');
  });

  test('a size that is out of stock cannot be chosen', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-04');
    await expect(page.getByRole('radio', { name: /^Size S/ })).toBeEnabled();
    // p02 (L low, XL out) is a Blueprint outfit: its out-of-stock size is shown struck through
    await page.goto('/index.html#/product/sample-outfit-02');
    await expect(page.locator('.sizes li.off')).toHaveCount(1);
  });

  test('a sold-out outfit says so and cannot be added', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-06');
    await expect(page.locator('.gallery .soldtag')).toHaveText('Sold out');
    await expect(page.locator('#add')).toBeDisabled();
    await expect(page.locator('#helper')).toHaveText('Out of stock');
  });

  test('Description stays in the page as text when collapsed; Material, Delivery and Returns are collapsible', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-01');
    const desc = page.locator('#desc');
    await expect(desc).toContainText('always in the page as real, readable text');
    const full = await desc.evaluate((el) => el.textContent.length);
    expect(full).toBeGreaterThan(150);
    expect(await desc.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true); // shortened on screen, not removed
    const more = page.getByRole('button', { name: /Read more/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(page.getByRole('button', { name: /Read less/ })).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Material', 'Delivery', 'Returns']) {
      const details = page.locator('details', { hasText: name }).first();
      await expect(details).not.toHaveAttribute('open', '');
      expect((await details.textContent()).length).toBeGreaterThan(name.length + 10); // text is in the DOM
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
    }
    await expect(page.locator('details', { hasText: 'Delivery' }).getByText('[Sample zone: Island]')).toBeVisible();
  });

  test('shows similar outfits of the same type, and hides the row when there are none', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-03');
    const row = page.getByRole('region', { name: 'Similar outfits' });
    const blazers = await ofType(page, 'blazer');
    await expect(row.locator('article')).toHaveCount(Math.min(6, blazers - 1));
    for (const label of await row.locator('article .no').allTextContents()) expect(label).toContain('[Blazer]');
    await page.goto('/index.html#/product/sample-outfit-05'); // the only suit
    await expect(page.getByRole('region', { name: 'Similar outfits' })).toHaveCount(0);
  });

  test('an unknown outfit says so', async ({ page }) => {
    await page.goto('/index.html#/product/nope');
    await expect(page.getByRole('heading', { name: 'Outfit not found' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('the Add to cart bar is fixed to the bottom; without a size it opens the size choice', async ({ page }) => {
      await page.goto('/index.html#/product/sample-outfit-08');
      const bar = page.locator('#sticky');
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(Math.round(box.y + box.height)).toBe(844);
      await page.mouse.wheel(0, 800);
      await expect(bar).toBeVisible();
      await page.locator('#add-sticky').click();
      const sheet = page.getByRole('dialog', { name: 'Quick add' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: /Size L/ }).click();
      await sheet.getByRole('button', { name: 'Add to cart' }).click();
      await expect(page.getByRole('dialog', { name: 'Your cart' })).toContainText('Size L');
    });
    test('for an outfit that needs Find My Size the bar sends you there', async ({ page }) => {
      await page.goto('/index.html#/product/sample-outfit-03');
      await page.locator('#add-sticky').click();
      await expect(page).toHaveURL(/#\/fit\/sample-outfit-03$/);
    });
  });

  test.describe('on a desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('there is no sticky bar', async ({ page }) => {
      await page.goto('/index.html#/product/sample-outfit-08');
      await expect(page.locator('#sticky')).toBeHidden();
    });
  });
});

test.describe('accessibility', () => {
  for (const [name, hash, setup] of [
    ['shop', '#/shop', null],
    ['shop, filtered', '#/shop?type=gown&sort=price_desc', null],
    ['shop page 2', '#/shop?page=2', null],
    ['search results', '#/search?q=blazer', null],
    ['search, no result', '#/search?q=zzzz', null],
    ['product with Find My Size', '#/product/sample-outfit-03', null],
    ['product with direct sizes', '#/product/sample-outfit-08', null],
    ['sold-out product', '#/product/sample-outfit-06', null],
    ['product with description open', '#/product/sample-outfit-01', async (page) => { await page.getByRole('button', { name: /Read more/ }).click(); await page.locator('summary').first().click(); }],
    ['quick add sheet', '#/shop', async (page) => { await page.locator('article.card[data-product="p04"] .quick').focus(); await page.keyboard.press('Enter'); }],
    ['quick add sheet (Find My Size outfit)', '#/shop', async (page) => { await page.locator('article.card[data-product="p01"] .quick').focus(); await page.keyboard.press('Enter'); }],
  ]) {
    test(`axe: ${name} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(`/index.html${hash}`);
      if (setup) await setup(page);
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});

test.describe('regressions', () => {
  test('adding to the cart after visiting a product page twice adds exactly once', async ({ page }) => {
    await page.goto('/index.html#/product/sample-outfit-08');
    await page.goto('/index.html#/shop');
    await page.goto('/index.html#/product/sample-outfit-08');
    await page.getByRole('radio', { name: /^Size M/ }).click();
    await page.locator('#add').click();
    await expect(page.getByRole('dialog', { name: 'Your cart' })).toContainText('[Sample outfit 08]');
    await expect(page.locator('[data-cart-count]')).toHaveText('2'); // 1 sample line already in the cart + 1
  });
});
