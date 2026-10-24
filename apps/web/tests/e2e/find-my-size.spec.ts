import { expect, test } from '@playwright/test';
import { TEST_PASSWORD } from './mail';
import {
  PROFILE_PRODUCT,
  fillMeasurements,
  fitDialog,
  openFitDialog,
  reachRecommendation,
  signUp,
} from './shopping';

test.describe('Find My Size', () => {
  test('a logged-out shopper is sent to login and returns to the same product with the dialog open', async ({
    page,
  }) => {
    await page.goto(PROFILE_PRODUCT);
    await expect(page.getByText('Sign in to find your size.')).toBeVisible();
    await expect(page.getByRole('button', { name: /find my size/i })).toHaveCount(0);

    await page.getByRole('link', { name: 'Sign in to continue' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fproducts%2Fe2e-with-video%3Fintent%3Dfit/);

    // Register from the login page, keeping the return path.
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/register\?next=/);
    const email = `e2e-fit-return-${Date.now()}@example.test`;
    await page.getByLabel('Full name').fill('Ada Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('I accept the terms and conditions.').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/products\/e2e-with-video$/); // intent removed from the address
    await expect(fitDialog(page)).toBeVisible();
  });

  test('chest 42 gives size L; accepting it is a locked recommendation', async ({ page }) => {
    await signUp(page, 'fit-accept');
    await page.goto(PROFILE_PRODUCT);
    await reachRecommendation(page, '42');

    const dialog = fitDialog(page);
    await expect(dialog.getByTestId('recommended-size')).toHaveText('Size L');
    await expect(dialog.getByRole('table')).toContainText('Chest');
    await expect(
      dialog.getByText(/largest size that any of your measurements needs/),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Use size L' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('selected-size')).toHaveText(
      'Size L: recommended from your measurements',
    );
  });

  test('choosing a different size is an override with neutral wording', async ({ page }) => {
    await signUp(page, 'fit-override');
    await page.goto(PROFILE_PRODUCT);
    await reachRecommendation(page, '42');

    const dialog = fitDialog(page);
    await expect(dialog.getByRole('group', { name: 'Prefer a different size?' })).toBeVisible();
    await dialog.getByRole('radio', { name: /XL/ }).check();
    await dialog.getByRole('button', { name: 'Use size XL instead' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('selected-size')).toHaveText('Size XL: your choice');
  });

  test('a measurement above the chart gets the neutral message, no invented contact details', async ({
    page,
  }) => {
    await signUp(page, 'fit-range');
    await page.goto(PROFILE_PRODUCT);
    await reachRecommendation(page, '54');

    const dialog = fitDialog(page);
    await expect(dialog.getByRole('alert')).toContainText(
      'We could not match this measurement to our size chart.',
    );
    await expect(dialog.getByText(/contact us/i)).toHaveCount(0); // support settings are not set
    // What was typed is still there, and the shopper can correct it.
    await expect(dialog.getByLabel(/Chest/)).toHaveValue('54');
  });

  test('validates measurements before calling the API (one decimal, numbers only, required)', async ({
    page,
  }) => {
    await signUp(page, 'fit-input');
    await page.goto(PROFILE_PRODUCT);
    await openFitDialog(page);
    const dialog = fitDialog(page);
    await dialog.getByRole('button', { name: 'See my size' }).click();
    await expect(dialog.getByText('Enter a measurement.').first()).toBeVisible();

    await fillMeasurements(page, '42.55');
    await dialog.getByRole('button', { name: 'See my size' }).click();
    await expect(dialog.getByText('Use at most one decimal place.')).toBeVisible();

    await dialog.getByLabel(/Chest/).fill('42,5'); // a decimal comma is fine
    await dialog.getByRole('button', { name: 'See my size' }).click();
    await expect(dialog.getByTestId('recommended-size')).toBeVisible();
  });

  test('the dialog is keyboard friendly: Escape closes it and focus returns to the button', async ({
    page,
  }) => {
    await signUp(page, 'fit-keys');
    await page.goto(PROFILE_PRODUCT);
    const open = page.getByRole('button', { name: 'Find my size' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(fitDialog(page)).toBeVisible();
    await expect(fitDialog(page).getByLabel(/Chest/)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(fitDialog(page)).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('Body Scan is not offered while its flag is off', async ({ page }) => {
    await signUp(page, 'fit-noscan');
    await page.goto(PROFILE_PRODUCT);
    await openFitDialog(page);
    await expect(fitDialog(page).getByRole('button', { name: 'Start body scan' })).toHaveCount(0);
  });
});
