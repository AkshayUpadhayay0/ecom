import { expect, test, type Page } from '@playwright/test';
import { openMenu } from './helpers';
import {
  DIRECT_PRODUCT,
  PROFILE_PRODUCT,
  cartCount,
  fitDialog,
  openFitDialog,
  signUp,
} from './shopping';

/** The switcher lives in the side menu: open it, switch, close it again (Esc). */
async function switchTo(page: Page, language: 'English' | 'Pidgin'): Promise<void> {
  const menu = await openMenu(page);
  await menu
    .getByRole('group', { name: 'Language' })
    .getByRole('button', { name: language })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
}

// These run against the second web build, where the Pidgin switcher and Body Scan are switched on.

test.describe('Body Scan (MOCK provider, flag on)', () => {
  test('offers the scan, labels it as mocked, and feeds the same recommendation engine', async ({
    page,
  }) => {
    await signUp(page, 'scan');
    await page.goto(PROFILE_PRODUCT);
    await openFitDialog(page);
    const dialog = fitDialog(page);
    await expect(
      dialog.getByText('MOCK: this uses sample measurements, not a real body scan.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Start body scan' }).click();
    await expect(dialog.getByTestId('recommended-size')).toBeVisible();
    await expect(
      dialog.getByText('MOCK: this uses sample measurements, not a real body scan.'),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: /^Use size / })
      .first()
      .click();
    await expect(page.getByTestId('selected-size')).toContainText(
      'recommended from your measurements',
    );
  });
});

test.describe('language switcher (flag on)', () => {
  test('is visible and defaults to English', async ({ page }) => {
    await page.goto('/shop');
    const menu = await openMenu(page);
    const group = menu.getByRole('group', { name: 'Language' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('switching keeps the page, the query, the cart and the product names (copy falls back to English)', async ({
    page,
  }) => {
    await signUp(page, 'lang');
    await page.goto(DIRECT_PRODUCT);
    await page.getByRole('radio', { name: /^M/ }).check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.getByRole('button', { name: 'Close cart' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/shop?sort=name&page=2');
    await switchTo(page, 'Pidgin');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    await expect(page).toHaveURL(/\/shop\?sort=name&page=2$/);
    // No Pidgin copy exists yet: every string falls back to English.
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible();
    // Product names are never translated.
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    // The cart is on the server: it is untouched.
    await expect.poll(() => cartCount(page)).toBe(1);

    await switchTo(page, 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('entered data on the page is kept when the language changes', async ({ page }) => {
    await signUp(page, 'lang-data');
    await page.goto(DIRECT_PRODUCT);
    await page.getByLabel('Quantity').fill('3');
    await page.getByRole('radio', { name: /^L/ }).check();
    await switchTo(page, 'Pidgin');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    await expect(page.getByLabel('Quantity')).toHaveValue('3');
    await expect(page.getByRole('radio', { name: /^L/ })).toBeChecked();
  });
});
