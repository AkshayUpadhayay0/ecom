import { test } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';
const OUT = process.env.V3_SHOTS;
test("nav dialogs", async ({ page }) => {
  test.skip(!OUT);
  for (const w of [390, 1440]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
    await page.goto('/index.html#/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/h-menu-${w}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.getByRole('combobox').fill('blaz');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/h-search-${w}.png` });
    await page.getByRole('combobox').fill('zzzz');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/h-search-empty-${w}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open cart' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/h-cart-${w}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Prototype guide' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/h-guide-${w}.png` });
    await page.keyboard.press("Escape");
  }
});
