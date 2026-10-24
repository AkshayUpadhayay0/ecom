import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_PASSWORD, newTestEmail } from './mail';

export const PROFILE_PRODUCT = '/products/e2e-with-video'; // male_top profile; sizes M(0) L(2) XL(9)
export const DIRECT_PRODUCT = '/products/e2e-direct-shirt'; // no profile; M(50) L(2) XL(0)

/** Registers a fresh shopper and waits until they are signed in. Returns the email. */
export async function signUp(page: Page, label = 'shopper'): Promise<string> {
  const email = newTestEmail(label);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Ada Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('I accept the terms and conditions.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
  return email;
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
}

export function fitDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Find my size' });
}

/** Typical male-top measurements (inches); chest 42 is the one that decides the size. */
const SAMPLE: [RegExp, string][] = [
  [/chest/i, '42'],
  [/shoulder/i, '17'],
  [/sleeve/i, '24'],
  [/length/i, '28'],
];

/** Fills every measurement box in the dialog, overriding the chest value when given. */
export async function fillMeasurements(page: Page, chest = '42'): Promise<void> {
  const dialog = fitDialog(page);
  const inputs = dialog.locator('input[inputmode="decimal"]');
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const id = (await input.getAttribute('id')) ?? '';
    const label = (await dialog.locator(`label[for="${id}"]`).textContent()) ?? '';
    const entry = SAMPLE.find(([pattern]) => pattern.test(label));
    const value = /chest/i.test(label) ? chest : (entry?.[1] ?? '20');
    await input.fill(value);
  }
}

export async function openFitDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Find my size/ }).click();
  await expect(fitDialog(page)).toBeVisible();
}

/** Opens the dialog, enters measurements and shows the recommendation. */
export async function reachRecommendation(page: Page, chest = '42'): Promise<void> {
  await openFitDialog(page);
  await fillMeasurements(page, chest);
  await fitDialog(page).getByRole('button', { name: 'See my size' }).click();
}

export async function cartCount(page: Page): Promise<number> {
  return Number(await page.getByTestId('cart-count').textContent());
}
