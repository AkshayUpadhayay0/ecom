import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  DIRECT_PRODUCT,
  PROFILE_PRODUCT,
  fitDialog,
  fillMeasurements,
  openFitDialog,
  signUp,
} from './shopping';

async function expectNoViolations(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

test.describe('axe: account and shopping pages', () => {
  for (const [name, path] of [
    ['login', '/login'],
    ['register', '/register'],
    ['forgot password', '/forgot-password'],
    ['reset password (no token)', '/reset-password'],
    ['verify email (no token)', '/verify-email'],
  ] as const) {
    test(`${name} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expectNoViolations(page);
    });
  }

  test('login with an error summary has no violations', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('main [role=alert]')).toBeVisible();
    await expectNoViolations(page);
  });

  test('account page (profile and address form) has no violations', async ({ page }) => {
    await signUp(page, 'axe-account');
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Add an address' }).click();
    await page
      .getByRole('form', { name: 'Add an address' })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.locator('main [role=alert]')).toBeVisible();
    await expectNoViolations(page);
  });

  test('product pages signed in (both size modes), Find My Size dialog and cart have no violations', async ({
    page,
  }) => {
    await signUp(page, 'axe-shop');
    await page.goto(DIRECT_PRODUCT);
    await expectNoViolations(page);

    await page.goto(PROFILE_PRODUCT);
    await expectNoViolations(page);
    await openFitDialog(page);
    await expectNoViolations(page);
    await fillMeasurements(page, '42');
    await fitDialog(page).getByRole('button', { name: 'See my size' }).click();
    await expect(fitDialog(page).getByTestId('recommended-size')).toBeVisible();
    await expectNoViolations(page);
    await fitDialog(page).getByRole('button', { name: 'Use size L' }).click();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Close cart' }).click();

    await page.goto('/cart');
    await expect(page.getByTestId('cart-line')).toBeVisible();
    await expectNoViolations(page);
  });

  test('empty cart has no violations', async ({ page }) => {
    await signUp(page, 'axe-empty');
    await page.goto('/cart');
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await expectNoViolations(page);
  });
});
