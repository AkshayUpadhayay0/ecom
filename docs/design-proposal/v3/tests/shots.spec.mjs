// Screenshots for review (only when V3_SHOTS=<folder> is set): V3_SHOTS=... V3_HASHES="shop,product" ...
import { test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';

const OUT = process.env.V3_SHOTS;
const SCREENS = {
  shop: '#/shop',
  shopsold: '#/shop?page=1',
  product: '#/product/sample-outfit-03',
  direct: '#/product/sample-outfit-08',
  sold: '#/product/sample-outfit-06',
  search: '#/search?q=blazer',
  fit: '#/fit/sample-outfit-03',
  concept: '#/fit-concept',
};
const WANT = (process.env.V3_HASHES ?? Object.keys(SCREENS).join(',')).split(',');

test.skip(!OUT, 'set V3_SHOTS to take screenshots');
for (const name of WANT) {
  for (const w of [390, 768, 1440]) {
    test(`${name} at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
      await page.goto(`/index.html${SCREENS[name]}`);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/s-${name}-${w}.png`, fullPage: false });
    });
  }
}
