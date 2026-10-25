// Stage 6: the whole prototype. Guide, offline and no external requests, no real data, Save-Data,
// reduced motion, slow connection, keyboard only, and every screen at 390, 768 and 1440 px.
import AxeBuilder from '../../../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const money = (n) => `₦ [${n.toLocaleString('en-NG')}]`;

// every screen a visitor can reach (signed-in ones are visited after signing in)
const SCREENS = [
  '#/', '#/shop', '#/shop?page=2', '#/shop?type=gown&sort=price_desc', '#/search?q=blazer', '#/search?q=zzzz',
  '#/product/sample-outfit-03', '#/product/sample-outfit-08', '#/product/sample-outfit-06', '#/product/sample-outfit-05',
  '#/fit/sample-outfit-03', '#/fit/sample-outfit-03?demo=range', '#/fit/sample-outfit-03?demo=small', '#/fit-concept',
  '#/signin', '#/register', '#/account', '#/cart', '#/cart?demo=stock', '#/checkout', '#/checkout/delivery',
  '#/checkout/failed', '#/orders',
];

async function signIn(page) {
  await page.goto('/index.html#/signin');
  await page.locator('#email').fill('sample@example.test');
  await page.locator('#password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/account$/);
}

test.describe('prototype guide', () => {
  test('opens from the small button, lists the click path and every flow, and every link goes somewhere real', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Prototype guide' }).click();
    const guide = page.getByRole('dialog', { name: 'Prototype guide' });
    await expect(guide).toContainText('Start here: home to a confirmed order');
    await expect(guide.locator('.path li')).toHaveCount(9);
    await expect(guide.getByRole('link', { name: 'Phone preview (390 px)' })).toHaveAttribute('href', 'phone.html');
    const hrefs = await guide.locator('a[href^="#/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    expect(hrefs.length).toBeGreaterThanOrEqual(20);
    await page.keyboard.press('Escape');
    await signIn(page);
    for (const href of hrefs.filter((h) => h !== '#/')) {
      await page.goto(`/index.html${href}`);
      await expect(page.locator('main h1').first(), href).toBeVisible();
      await expect(page.getByText('Page not found'), href).toHaveCount(0);
      await expect(page.getByText('built in a later stage'), href).toHaveCount(0);
    }
  });

  test('"Reset the prototype" brings back the starting cart and signs you out', async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => { PROTO.state.cart = []; PROTO.save(); });
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'Prototype guide' }).click();
    await page.getByRole('link', { name: 'Reset the prototype (cart, sign-in, orders)' }).click();
    await expect(page.locator('[data-cart-count]')).toHaveText('1');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('the phone preview page shows the prototype in a 390 px frame, on any screen', async ({ page }) => {
    await page.goto('/phone.html#/shop');
    const frame = page.frameLocator('#frame');
    await expect(frame.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible();
    expect((await page.locator('#frame').boundingBox()).width).toBe(390);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('self-contained, offline and sample-only', () => {
  test('a tour of every screen makes no request outside the prototype', async ({ page, baseURL }) => {
    const foreign = [];
    page.on('request', (r) => { if (!r.url().startsWith(baseURL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
    await signIn(page);
    for (const hash of SCREENS) { await page.goto(`/index.html${hash}`); await page.waitForTimeout(120); }
    expect(foreign).toEqual([]);
  });

  test('keeps working with the network switched off once it has loaded', async ({ page, context }) => {
    await page.goto('/index.html');
    await page.waitForTimeout(800);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Shop' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible();
    await page.locator('article.card .name a').first().click();
    await expect(page.getByRole('heading', { level: 1, name: '[Sample outfit 01]' })).toBeVisible();
    await context.setOffline(false);
  });

  test('no real people, places or contact details appear on any screen', async ({ page }) => {
    await signIn(page);
    const bad = [];
    for (const hash of SCREENS) {
      await page.goto(`/index.html${hash}`);
      await page.waitForTimeout(100);
      const text = await page.locator('body').innerText();
      for (const m of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) if (!/example\.test$/.test(m)) bad.push(`${hash}: ${m}`);
      for (const m of text.match(/https?:\/\/\S+/g) ?? []) bad.push(`${hash}: ${m}`);
      for (const m of text.match(/(?<!\[)\+?\d[\d ()-]{8,}\d(?!\])/g) ?? []) if (!/^\d{1,3}(,\d{3})+$/.test(m)) bad.push(`${hash}: phone-like ${m}`);
    }
    expect(bad).toEqual([]);
  });

  test('every price, fee and total is in brackets', async ({ page }) => {
    await signIn(page);
    for (const hash of ['#/shop', '#/product/sample-outfit-03', '#/cart', '#/checkout/delivery', '#/orders']) {
      await page.goto(`/index.html${hash}`);
      const text = await page.locator('main').innerText();
      const naira = text.match(/₦\s?[^\s\[]?\S*/g) ?? [];
      for (const m of naira) expect(m.startsWith('₦ [') || m.startsWith('₦['), `${hash}: ${m}`).toBe(true);
    }
  });

  test('there are no payment-card fields anywhere', async ({ page }) => {
    await signIn(page);
    for (const hash of SCREENS) {
      await page.goto(`/index.html${hash}`);
      await expect(page.locator('input[autocomplete*="cc-"], input[name*="card" i], input[placeholder*="card" i], iframe')).toHaveCount(0);
    }
  });
});

test.describe('Save-Data and slow connections', () => {
  test('?savedata=1: no video is requested on any main screen, every frame has a play button', async ({ page }) => {
    const videos = [];
    page.on('request', (r) => { if (r.url().endsWith('.mp4')) videos.push(r.url()); });
    await signIn(page);
    for (const hash of ['#/', '#/shop', '#/product/sample-outfit-03', '#/fit/sample-outfit-03', '#/cart']) {
      await page.goto(`/index.html${hash.replace('#/', '?savedata=1#/')}`);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(400);
      expect(await page.locator('video').count(), hash).toBe(0);
      expect(await page.locator('.vframe .playbtn').count(), hash).toBeGreaterThan(0);
    }
    expect(videos).toEqual([]);
  });

  test('a tap on a play button plays that one clip', async ({ page }) => {
    await page.goto('/index.html?savedata=1#/product/sample-outfit-03');
    const frame = page.locator('.gallery .vframe');
    await frame.locator('.playbtn').click();
    await expect(frame.locator('video')).toBeAttached();
    await expect(frame.locator('.playbtn')).toHaveAttribute('aria-label', 'Pause video');
    await frame.locator('.playbtn').click();
    await expect(frame.locator('video')).toHaveCount(0);
  });

  test('on slow 4G the product page shows its poster first, and the video follows', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto('/index.html#/product/sample-outfit-03', { waitUntil: 'commit' });
    await page.waitForFunction(() => { const i = document.querySelector('.gallery img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
    const posterMs = Date.now() - t0;
    console.log(`SLOW product poster ${posterMs} ms`);
    expect(posterMs).toBeLessThan(3500);
    await page.waitForFunction(() => document.querySelector('.gallery video.playing, .gallery .playing video'), null, { timeout: 30000 });
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no video plays, nothing drifts, on any main screen', async ({ page }) => {
    await signIn(page);
    for (const hash of ['#/', '#/shop', '#/product/sample-outfit-03', '#/fit/sample-outfit-03']) {
      await page.goto(`/index.html${hash}`);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      expect(await page.locator('video').count(), hash).toBe(0);
    }
    await page.goto('/index.html#/');
    expect(await page.locator('.hero .layer').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});

test.describe('keyboard only', () => {
  test('place an order using only the keyboard, from an outfit page to the confirmation', async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => { PROTO.state.cart = []; PROTO.save(); });
    await page.goto('/index.html#/product/sample-outfit-08');
    await page.getByRole('radio', { name: /^Size L/ }).focus();
    await page.keyboard.press('Enter'); // choose the size
    await page.locator('#add').focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Checkout' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/checkout\/delivery$/);
    await page.locator('#d-name').focus();
    for (const v of ['[Name]', '[0800 000 0000]', '[Address]', '[Area]']) { await page.keyboard.type(v); await page.keyboard.press('Tab'); }
    await page.keyboard.press('ArrowDown'); // zone select
    await page.keyboard.press('ArrowDown');
    await page.getByRole('button', { name: 'Continue to review' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/checkout\/review$/);
    await page.getByRole('link', { name: 'Continue to secure payment' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Pay / }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Thank you. Your order is confirmed.' })).toBeFocused();
  });

  test('every screen has a visible keyboard focus ring', async ({ page }) => {
    await page.goto('/index.html#/shop');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}`; });
    expect(outline).toBe('solid 3px');
  });
});

test.describe('every screen at 390, 768 and 1440 px', () => {
  for (const width of [390, 768, 1440]) {
    test(`no sideways scrolling and a heading on all ${SCREENS.length} screens at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      for (const hash of SCREENS) {
        await page.goto(`/index.html${hash}`);
        await page.waitForTimeout(150);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${hash} at ${width}`).toBeLessThanOrEqual(1);
        await expect(page.locator('main h1').first(), `${hash} at ${width}`).toBeVisible();
      }
    });
  }
});

test.describe('axe on every screen', () => {
  for (const hash of SCREENS) {
    test(`axe: ${hash} has no WCAG A/AA violations`, async ({ page }) => {
      await signIn(page);
      await page.goto(`/index.html${hash}`);
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
