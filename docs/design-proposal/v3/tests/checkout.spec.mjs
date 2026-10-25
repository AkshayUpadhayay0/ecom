// Stage 5: cart, checkout (account, delivery, review, payment), confirmation, failed payment, My orders.
import AxeBuilder from '../../../../apps/web/node_modules/@axe-core/playwright/dist/index.mjs';
import { expect, test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const money = (n) => `₦ [${n.toLocaleString('en-NG')}]`;

async function signIn(page) {
  await page.goto('/index.html#/signin');
  await page.locator('#email').fill('sample@example.test');
  await page.locator('#password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/account$/);
}

async function sampleDelivery(page, zone = /Island/) {
  await page.getByRole('button', { name: 'Fill in sample details' }).click();
  await page.getByLabel('Delivery zone').selectOption({ label: await page.locator('#d-zone option', { hasText: zone }).first().textContent() });
}

async function toReview(page) {
  await signIn(page);
  await page.goto('/index.html#/checkout/delivery');
  await sampleDelivery(page);
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(page).toHaveURL(/#\/checkout\/review$/);
}

test.describe('cart page', () => {
  test('lists the line with size, fit, price each and a way back into Find My Size; quantity and remove work', async ({ page }) => {
    await page.goto('/index.html#/cart');
    await expect(page.getByRole('heading', { level: 1, name: 'Your cart' })).toBeVisible();
    const line = page.locator('.cart-lines .line').first();
    await expect(line).toContainText('[Sample outfit 01]');
    await expect(line).toContainText('Size M');
    await expect(line).toContainText('Recommended for your measurements');
    await expect(line).toContainText(`${money(48000)} each`);
    await expect(line.getByRole('link', { name: 'Reopen Find my size' })).toHaveAttribute('href', '#/fit/sample-outfit-01');
    await expect(page.getByTestId('subtotal')).toHaveText(money(48000));
    await line.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(page.getByTestId('subtotal')).toHaveText(money(96000));
    await expect(page.locator('[data-cart-count]')).toHaveText('2');
    await page.getByText('Delivery is added at checkout.').isVisible();
    await line.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue shopping' })).toBeVisible();
  });

  test('a line with too little stock blocks checkout until the quantity is lowered', async ({ page }) => {
    await page.goto('/index.html#/cart?demo=stock');
    await expect(page.getByText('Fewer are available than your quantity. Lower the quantity to continue.')).toBeVisible();
    await expect(page.getByText('Fix the items marked above to continue.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    const line = page.locator('.cart-lines .line', { hasText: '[Sample outfit 10]' });
    await line.getByRole('button', { name: /Decrease quantity/ }).click();
    await line.getByRole('button', { name: /Decrease quantity/ }).click();
    await expect(page.getByText('Fewer are available than your quantity.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Checkout' })).toBeVisible();
  });
});

test.describe('checkout', () => {
  test('signed out: asks you to sign in or create an account, then carries on to delivery', async ({ page }) => {
    await page.goto('/index.html#/checkout');
    await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Checkout steps' }).locator('[aria-current=step]')).toContainText('1. Account');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/#\/register\?next=%2Fcheckout/);
    await page.locator('#name').fill('x');
    await page.locator('#email').fill('a@b.co');
    await page.locator('#password').fill('a-long-password-1');
    await page.getByLabel('I accept the terms and conditions.').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/#\/checkout\/delivery$/);
  });

  test('an empty cart has nothing to check out', async ({ page }) => {
    await page.goto('/index.html#/cart');
    await page.getByRole('button', { name: /Remove/ }).click();
    await page.goto('/index.html#/checkout');
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
  });

  test('delivery: validates, shows the zone fee in the summary as you choose, and keeps sample figures in brackets', async ({ page }) => {
    await signIn(page);
    await page.goto('/index.html#/checkout/delivery');
    await expect(page.getByRole('list', { name: 'Checkout steps' }).locator('[aria-current=step]')).toContainText('2. Delivery');
    await expect(page.getByTestId('total')).toHaveText(money(48000));
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByText('This field is required.').first()).toBeVisible();
    await expect(page.getByText('Choose a delivery zone.')).toBeVisible();
    await expect(page.locator('#d-name')).toBeFocused();
    await page.getByRole('button', { name: 'Fill in sample details' }).click();
    await expect(page.locator('#d-name')).toHaveValue('[Sample name]');
    await page.getByLabel('Delivery zone').selectOption({ index: 3 });
    await expect(page.getByTestId('total')).toHaveText(money(48000 + 4500));
    await page.getByLabel('Delivery zone').selectOption({ index: 1 });
    await expect(page.getByTestId('total')).toHaveText(money(48000 + 2500));
    await expect(page.locator('#d-zone option').nth(1)).toContainText('[Sample zone: Island]');
    await page.locator('#d-phone').fill('12');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByText('Enter a valid phone number.')).toBeVisible();
  });

  test('review shows products, sizes, quantities, subtotal, delivery charge and total', async ({ page }) => {
    await toReview(page);
    await expect(page.getByRole('heading', { name: 'Review your order' })).toBeFocused();
    await expect(page.locator('.cart-lines')).toContainText('[Sample outfit 01]');
    await expect(page.locator('.cart-lines')).toContainText('Size M');
    await expect(page.locator('.cart-lines')).toContainText('Quantity 1');
    const summary = page.getByRole('complementary', { name: 'Order summary' });
    await expect(summary).toContainText(`Subtotal${money(48000)}`);
    await expect(summary).toContainText(`Delivery${money(2500)}`);
    await expect(page.getByTestId('total')).toHaveText(money(50500));
    await expect(page.getByText('[Sample street and number]')).toBeVisible();
    await page.getByRole('link', { name: 'Change' }).click();
    await expect(page).toHaveURL(/#\/checkout\/delivery$/);
    await expect(page.locator('#d-name')).toHaveValue('[Sample name]'); // kept in memory
  });

  test('the payment step is neutral: no card fields, no embedded page, a labelled Prototype switch', async ({ page }) => {
    await toReview(page);
    await page.getByRole('link', { name: 'Continue to secure payment' }).click();
    await expect(page.getByRole('heading', { name: 'Secure payment with Paystack' })).toBeFocused();
    await expect(page.getByTestId('due')).toHaveText(money(50500));
    expect(await page.locator('main iframe, main img[alt*="paystack" i], main input[type=text], main input[type=tel], main input[autocomplete*="cc-"]').count()).toBe(0);
    expect(await page.locator('main input').evaluateAll((els) => els.map((e) => e.type))).toEqual(['radio', 'radio']);
    const sw = page.getByRole('group', { name: /Prototype/ });
    await expect(sw).toContainText('Prototype');
    await expect(sw.getByRole('radio', { name: 'Payment succeeds' })).toBeChecked();
    await expect(page.getByText('This prototype does not copy that page')).toBeVisible();
  });

  test('guards the steps: review and payment need the earlier steps; a reload forgets typed details', async ({ page }) => {
    await signIn(page);
    await page.goto('/index.html#/checkout/review');
    await expect(page).toHaveURL(/#\/checkout\/delivery$/);
    await page.goto('/index.html#/checkout/pay');
    await expect(page).toHaveURL(/#\/checkout$|#\/checkout\/delivery$/);
    await page.goto('/index.html#/checkout/done');
    await expect(page).toHaveURL(/#\/$/);
  });

  test('typed delivery details are never stored', async ({ page }) => {
    await signIn(page);
    await page.goto('/index.html#/checkout/delivery');
    await page.locator('#d-name').fill('Zzyzx Qwerty');
    await page.locator('#d-phone').fill('08099887766');
    await page.locator('#d-address').fill('99 Nowhere Lane');
    await page.locator('#d-area').fill('Nowhereville');
    await page.getByLabel('Delivery zone').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByText('Zzyzx Qwerty')).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify([sessionStorage, localStorage, document.cookie]));
    for (const secret of ['Zzyzx', '08099887766', 'Nowhere']) expect(stored).not.toContain(secret);
  });
});

test.describe('the full click path: home to a confirmed order', () => {
  test('home, shop, outfit, Find My Size, cart, sign in, delivery, review, payment, confirmation, My orders', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: /Open cart/ }).click();
    await page.getByRole('button', { name: /Remove/ }).click(); // start from an empty cart
    await page.keyboard.press('Escape');
    // home -> shop -> outfit
    await page.getByRole('link', { name: 'Shop', exact: true }).first().click();
    await expect(page).toHaveURL(/#\/shop$/);
    await page.getByRole('link', { name: '[Sample outfit 03]' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[Sample outfit 03]');
    // Find My Size needs an account: sign in on the way
    await page.getByRole('link', { name: 'Find my size' }).first().click();
    await page.getByRole('link', { name: 'Sign in to continue' }).click();
    await page.locator('#email').fill('sample@example.test');
    await page.locator('#password').fill('x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Fill in sample measurements' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'See my size' }).click();
    await page.getByRole('button', { name: 'Use size M' }).click();
    await page.locator('#add').click();
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer).toContainText('[Sample outfit 03]');
    await drawer.getByRole('link', { name: 'View cart' }).click();
    await expect(page).toHaveURL(/#\/cart$/);
    await expect(page.getByTestId('subtotal')).toHaveText(money(52000));
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page).toHaveURL(/#\/checkout\/delivery$/); // already signed in
    await page.getByRole('button', { name: 'Fill in sample details' }).click();
    await page.getByLabel('Delivery zone').selectOption({ index: 2 });
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(page.getByTestId('total')).toHaveText(money(52000 + 2000));
    await page.getByRole('link', { name: 'Continue to secure payment' }).click();
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Confirming your payment' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thank you. Your order is confirmed.' })).toBeFocused();
    await expect(page.getByTestId('order-id')).toHaveText('Order UI-[0005]');
    await expect(page.getByText('Status: Being prepared')).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('0');
    await page.getByRole('link', { name: 'View my orders' }).click();
    const mine = page.locator('article.order', { hasText: 'UI-[0005]' });
    await expect(mine).toContainText(money(54000));
    await expect(mine.locator('[aria-current=step]')).toHaveText(/Being prepared/);
    // the status moves on (prototype control)
    await mine.getByRole('button', { name: 'Move this order to the next status' }).click();
    await expect(mine.locator('[aria-current=step]')).toHaveText(/Sent out/);
    await mine.getByRole('button', { name: 'Move this order to the next status' }).click();
    await expect(mine.locator('[aria-current=step]')).toHaveText(/Delivered/);
    await expect(mine.getByRole('button', { name: 'Move this order to the next status' })).toHaveCount(0);
  });

  test('a failed payment keeps the cart, offers a retry, and the retry can succeed', async ({ page }) => {
    await toReview(page);
    await page.getByRole('link', { name: 'Continue to secure payment' }).click();
    await page.getByRole('radio', { name: 'Payment fails' }).check();
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByRole('heading', { name: 'Your payment was not completed' })).toBeFocused();
    await expect(page.getByText('Nothing was charged and your cart is unchanged.')).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('1'); // the cart is not deleted
    await page.getByRole('link', { name: 'Try again' }).click();
    await expect(page).toHaveURL(/#\/checkout\/pay$/);
    await expect(page.getByRole('radio', { name: 'Payment fails' })).toBeChecked();
    await page.getByRole('radio', { name: 'Payment succeeds' }).check();
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect(page.getByTestId('order-id')).toHaveText('Order UI-[0005]');
    await expect(page.locator('[data-cart-count]')).toHaveText('0');
  });

  test('a second order gets the next number', async ({ page }) => {
    for (const expected of ['UI-[0005]', 'UI-[0006]']) {
      await page.goto('/index.html#/product/sample-outfit-08');
      await page.getByRole('radio', { name: /^Size M/ }).click();
      await page.locator('#add').click();
      await page.keyboard.press('Escape');
      await page.goto('/index.html#/signin');
      await page.locator('#email').fill('sample@example.test');
      await page.locator('#password').fill('x');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.goto('/index.html#/checkout/delivery');
      await sampleDelivery(page);
      await page.getByRole('button', { name: 'Continue to review' }).click();
      await page.getByRole('link', { name: 'Continue to secure payment' }).click();
      await page.getByRole('button', { name: /^Pay / }).click();
      await expect(page.getByTestId('order-id')).toHaveText(`Order ${expected}`);
      await page.evaluate(() => { PROTO.state.cart = []; PROTO.save(); });
    }
  });
});

test.describe('My orders', () => {
  test('signed out, asks you to sign in', async ({ page }) => {
    await page.goto('/index.html#/orders');
    await expect(page.getByText('Sign in to see your orders.')).toBeVisible();
  });

  test('signed in: shows each order with the Being prepared, Sent out, Delivered timeline', async ({ page }) => {
    await signIn(page);
    await page.goto('/index.html#/orders');
    const delivered = page.locator('article.order', { hasText: 'UI-[0003]' });
    await expect(delivered.getByRole('list', { name: 'Order status' }).getByRole('listitem')).toHaveText(['Done: Being prepared', 'Done: Sent out', 'Current: Delivered']);
    const sent = page.locator('article.order', { hasText: 'UI-[0004]' });
    await expect(sent.locator('[aria-current=step]')).toHaveText(/Sent out/);
    await expect(sent).toContainText('Placed [date]');
    await expect(sent).toContainText('[Sample outfit 04]');
    // seeded orders have no prototype control
    await expect(delivered.getByRole('button')).toHaveCount(0);
  });
});

test.describe('layout', () => {
  for (const width of [390, 768, 1440]) {
    test(`no sideways scrolling at ${width}px on every cart and checkout screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page);
      const flat = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      for (const hash of ['#/cart', '#/checkout/delivery']) {
        await page.goto(`/index.html${hash}`);
        await page.waitForTimeout(250);
        expect(await flat(), hash).toBeLessThanOrEqual(1);
      }
      await sampleDelivery(page);
      await page.getByRole('button', { name: 'Continue to review' }).click();
      expect(await flat()).toBeLessThanOrEqual(1);
      await page.getByRole('link', { name: 'Continue to secure payment' }).click();
      expect(await flat()).toBeLessThanOrEqual(1);
      for (const hash of ['#/checkout/failed', '#/orders']) {
        await page.goto(`/index.html${hash}`);
        await page.waitForTimeout(250);
        expect(await flat(), hash).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the payment wait shows text, not a moving spinner', async ({ page }) => {
    await toReview(page);
    await page.getByRole('link', { name: 'Continue to secure payment' }).click();
    await page.getByRole('button', { name: /^Pay / }).click();
    const spinner = page.locator('.spinner');
    if (await spinner.count()) {
      const duration = await spinner.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
      expect(duration).toBeLessThan(0.05);
    }
    await expect(page.getByTestId('order-id')).toBeVisible();
  });
});

test.describe('accessibility', () => {
  const states = [
    ['cart', async (page) => { await page.goto('/index.html#/cart'); }],
    ['cart, empty', async (page) => { await page.goto('/index.html#/cart'); await page.getByRole('button', { name: /Remove/ }).click(); }],
    ['cart, stock problem', async (page) => { await page.goto('/index.html#/cart?demo=stock'); }],
    ['checkout, account step', async (page) => { await page.goto('/index.html#/checkout'); }],
    ['checkout, delivery', async (page) => { await signIn(page); await page.goto('/index.html#/checkout/delivery'); }],
    ['checkout, delivery with errors', async (page) => { await signIn(page); await page.goto('/index.html#/checkout/delivery'); await page.getByRole('button', { name: 'Continue to review' }).click(); }],
    ['checkout, review', async (page) => { await toReview(page); }],
    ['checkout, payment', async (page) => { await toReview(page); await page.getByRole('link', { name: 'Continue to secure payment' }).click(); }],
    ['checkout, payment waiting', async (page) => { await toReview(page); await page.getByRole('link', { name: 'Continue to secure payment' }).click(); await page.getByRole('button', { name: /^Pay / }).click(); }],
    ['payment failed', async (page) => { await page.goto('/index.html#/checkout/failed'); }],
    ['order confirmed', async (page) => { await toReview(page); await page.getByRole('link', { name: 'Continue to secure payment' }).click(); await page.getByRole('button', { name: /^Pay / }).click(); await expect(page.getByTestId('order-id')).toBeVisible(); }],
    ['my orders', async (page) => { await signIn(page); await page.goto('/index.html#/orders'); }],
    ['my orders, signed out', async (page) => { await page.goto('/index.html#/orders'); }],
  ];
  for (const [name, setup] of states) {
    test(`axe: ${name} has no WCAG A/AA violations`, async ({ page }) => {
      await setup(page);
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
