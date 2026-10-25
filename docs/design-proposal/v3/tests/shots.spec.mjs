// Screenshots for review (only when V3_SHOTS=<folder> is set).
//   V3_SHOTS=<folder> V3_HASHES="shop,product" V3_WIDTHS="390,768" pnpm exec playwright test ... shots
import { test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const OUT = process.env.V3_SHOTS;
const SCREENS = {
  home: '#/',
  shop: '#/shop',
  shop2: '#/shop?page=2',
  product: '#/product/sample-outfit-03',
  direct: '#/product/sample-outfit-08',
  sold: '#/product/sample-outfit-06',
  search: '#/search?q=blazer',
  fit1: '#/fit/sample-outfit-03',
  fit3: '#/fit/sample-outfit-03?step=3',
  range: '#/fit/sample-outfit-03?demo=range',
  concept: '#/fit-concept',
  cart: '#/cart',
  signin: '#/signin',
  delivery: '#/checkout/delivery',
  review: '#/checkout/review',
  pay: '#/checkout/pay',
  failed: '#/checkout/failed',
  done: '#/checkout/done',
  orders: '#/orders',
};
const WANT = (process.env.V3_HASHES ?? Object.keys(SCREENS).join(',')).split(',');
const WIDTHS = (process.env.V3_WIDTHS ?? '390,768,1440').split(',').map(Number);

test.skip(!OUT, 'set V3_SHOTS to take screenshots');
for (const name of WANT) {
  for (const w of WIDTHS) {
    test(`${name} at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w === 1440 ? 900 : w === 768 ? 1024 : 844 });
      await page.goto('/index.html#/signin');
      await page.locator('#email').fill('a@b.co');
      await page.locator('#password').fill('x');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.goto(`/index.html${SCREENS[name]}`);
      if (name === 'fit3') {
        await page.getByRole('button', { name: 'Fill in sample measurements' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('button', { name: 'See my size' }).click();
      }
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/s-${name}-${w}.png`, fullPage: true });
    });
  }
}
