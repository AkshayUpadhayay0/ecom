import { expect, test, type Page } from '@playwright/test';
import { TEST_PASSWORD, newTestEmail, waitForLink } from './mail';

const VERIFY_SUBJECT = /Confirm your Urban Ibile email/;
const RESET_SUBJECT = /Reset your Urban Ibile password/;

async function register(page: Page, email: string, next?: string): Promise<void> {
  await page.goto(next ? `/register?next=${encodeURIComponent(next)}` : '/register');
  await page.getByLabel('Full name').fill('Ada Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('I accept the terms and conditions.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Registers and waits until the shopper is signed in (landed on the home page). */
async function registerAndWait(page: Page, email: string): Promise<void> {
  await register(page, email);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
}

const alertBox = (page: Page) => page.locator('main [role="alert"]');

async function login(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
  next?: string,
): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('accounts', () => {
  test('register signs the shopper in and the emailed link verifies the address', async ({
    page,
  }) => {
    const email = newTestEmail('register');
    await register(page, email);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    const link = await waitForLink(email, VERIFY_SUBJECT);
    await page.goto(link);
    await expect(page.getByText('Your email address is confirmed.')).toBeVisible();
    // The one-time token is removed from the address bar.
    await expect(page).toHaveURL(/\/verify-email$/);

    await page.goto('/account');
    await expect(page.getByText('Your email is confirmed.')).toBeVisible();
  });

  test('shows friendly errors for a duplicate email and an invalid form', async ({
    page,
    context,
  }) => {
    const email = newTestEmail('dup');
    await register(page, email);
    await expect(page).toHaveURL('/');
    await context.clearCookies();

    await register(page, email);
    await expect(alertBox(page)).toContainText('An account with this email already exists');

    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    const summary = alertBox(page);
    await expect(summary).toContainText('Please fix the following');
    await expect(summary).toBeFocused();
  });

  test('the password rules from the API are shown upfront and a too-short password is caught', async ({
    page,
  }) => {
    await page.goto('/register');
    await expect(
      page.getByText('Use at least 10 characters. Very common passwords are not accepted.'),
    ).toBeVisible();
    await page.getByLabel('Full name').fill('Ada Tester');
    await page.getByLabel('Email').fill(newTestEmail('short-pass'));
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('I accept the terms and conditions.').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(alertBox(page)).toContainText('shorter than the minimum shown above');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a logged-out visit to the account page goes to login and comes back after signing in', async ({
    page,
  }) => {
    const email = newTestEmail('return');
    await registerAndWait(page, email);
    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/');

    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  });

  test('ignores an external "next" address after login', async ({ page, context }) => {
    const email = newTestEmail('redirect');
    await registerAndWait(page, email);
    await context.clearCookies();
    await login(page, email, TEST_PASSWORD, 'https://evil.example/steal');
    await expect(page).toHaveURL('/');
  });

  test('wrong password shows a generic message and repeated failures lock the account', async ({
    page,
    context,
  }) => {
    const email = newTestEmail('lock');
    await registerAndWait(page, email);
    await context.clearCookies();

    await login(page, email, 'Wrong-Password-1');
    await expect(alertBox(page)).toContainText('That email and password do not match.');
    for (let i = 0; i < 5; i += 1) {
      await page.getByLabel('Password', { exact: true }).fill('Wrong-Password-2');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(alertBox(page)).toBeVisible();
    }
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(alertBox(page)).toContainText('locked for a while');
  });

  test('forgot password: emailed link sets a new password', async ({ page, context }) => {
    const email = newTestEmail('reset');
    await registerAndWait(page, email);
    await context.clearCookies();

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();

    const link = await waitForLink(email, RESET_SUBJECT);
    await page.goto(link);
    await expect(page).toHaveURL(/\/reset-password$/); // token removed from the URL
    const next = 'Another-Strong-Pass-7';
    await page.getByLabel('New password').fill(next);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText(/password has been changed/)).toBeVisible();

    await login(page, email, next);
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
  });

  test('an incomplete or reused link explains itself', async ({ page }) => {
    await page.goto('/verify-email');
    await expect(page.getByText('This confirmation link is incomplete.')).toBeVisible();
    await page.goto('/reset-password?token=not-a-real-token');
    await page.getByLabel('New password').fill('Some-Strong-Pass-1');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(alertBox(page)).toContainText(/not valid|expired/);
  });
});

test.describe('session cookies', () => {
  test('tokens live only in HttpOnly cookies, never in storage or script-readable cookies', async ({
    page,
    context,
  }) => {
    const email = newTestEmail('cookies');
    await register(page, email);
    await expect(page).toHaveURL('/');

    const cookies = await context.cookies();
    const byName = Object.fromEntries(cookies.map((c) => [c.name, c]));
    expect(byName.ui_at?.httpOnly).toBe(true);
    expect(byName.ui_rt?.httpOnly).toBe(true);
    expect(byName.ui_rt?.path).toBe('/api/bff');
    expect(byName.ui_at?.sameSite).toBe('Lax');

    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('ui_at');
    expect(visible).not.toContain('ui_rt');
    const stored = await page.evaluate(
      () =>
        JSON.stringify(Object.entries(localStorage)) +
        JSON.stringify(Object.entries(sessionStorage)),
    );
    expect(stored).not.toMatch(/eyJ/); // no JWT anywhere in web storage
  });

  test('an expired access cookie is renewed transparently', async ({ page, context }) => {
    const email = newTestEmail('refresh');
    await register(page, email);
    await expect(page).toHaveURL('/');
    await context.clearCookies({ name: 'ui_at' });

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toContain('ui_at');
  });

  test('a lost session (no refresh cookie) sends the shopper to login', async ({
    page,
    context,
  }) => {
    const email = newTestEmail('lost');
    await register(page, email);
    await expect(page).toHaveURL('/');
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await context.clearCookies({ name: 'ui_at' });
    await context.clearCookies({ name: 'ui_rt' });
    await page.reload();
    await expect(page).toHaveURL(/\/login\?next=%2Faccount|\/account/);
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15_000 });
  });

  test('mutations without the CSRF token are refused', async ({ page, request }) => {
    const email = newTestEmail('csrf');
    await register(page, email);
    await expect(page).toHaveURL('/');
    const response = await request.post('/api/bff/auth/logout');
    expect(response.status()).toBe(403);
    const crossOrigin = await request.post('/api/bff/auth/logout', {
      headers: { origin: 'https://evil.example', 'x-ui-csrf': 'anything' },
    });
    expect(crossOrigin.status()).toBe(403);
  });

  test('private BFF answers are never cacheable: no-store, no ETag, and a conditional request is a plain 200', async ({
    page,
  }) => {
    await register(page, newTestEmail('headers'));
    await expect(page).toHaveURL('/');
    for (const path of ['/api/bff/auth/me', '/api/bff/cart', '/api/bff/me/addresses']) {
      const first = await page.request.get(path);
      expect(first.status(), path).toBe(200);
      expect(first.headers()['cache-control'], path).toBe('no-store');
      expect(first.headers().etag, path).toBeUndefined();
      const conditional = await page.request.get(path, { headers: { 'If-None-Match': '*' } });
      expect(conditional.status(), `${path} conditional`).toBe(200);
    }
    // Errors are private too.
    const refused = await page.request.get('/api/bff/admin/orders');
    expect(refused.status()).toBe(404);
    expect(refused.headers()['cache-control']).toBe('no-store');
    expect(refused.headers().etag).toBeUndefined();
  });

  test('the BFF refuses paths outside its allow-list', async ({ request }) => {
    expect((await request.get('/api/bff/admin/stats/overview')).status()).toBe(404);
    expect((await request.get('/api/bff/checkout/orders')).status()).toBe(404);
  });
});

/** The address form's own Save button (the profile form on the same page has one too). */
async function saveAddress(page: Page, form = 'Add an address'): Promise<void> {
  await page.getByRole('form', { name: form }).getByRole('button', { name: 'Save' }).click();
}

test.describe('saved addresses', () => {
  test('add, edit, make default and remove an address', async ({ page }) => {
    const email = newTestEmail('address');
    await registerAndWait(page, email);
    await page.goto('/account');

    await page.getByRole('button', { name: 'Add an address' }).click();
    await page.getByLabel('Recipient name').fill('Ada Tester');
    await page.getByLabel('Phone', { exact: true }).fill('+2348012345678');
    await page.getByLabel('Address line 1').fill('12 Marina Road');
    await page.getByLabel('City').fill('Lagos');
    await page.getByLabel('Delivery zone').selectOption({ label: 'E2E Lagos' });
    await saveAddress(page);
    await expect(page.getByText('Address saved.')).toBeVisible();
    const card = page.getByTestId('address-card').first();
    await expect(card).toContainText('12 Marina Road');
    await expect(card).toContainText('Default'); // the first address becomes the default

    await page.getByRole('button', { name: 'Add an address' }).click();
    await page.getByLabel('Recipient name').fill('Bola Tester');
    await page.getByLabel('Phone', { exact: true }).fill('+2348099999999');
    await page.getByLabel('Address line 1').fill('3 Allen Avenue');
    await page.getByLabel('City').fill('Ikeja');
    await page.getByLabel('Delivery zone').selectOption({ label: 'E2E Lagos' });
    await saveAddress(page);
    await expect(page.getByTestId('address-card')).toHaveCount(2);

    const second = page.getByTestId('address-card').filter({ hasText: '3 Allen Avenue' });
    await second.getByRole('button', { name: 'Make default' }).click();
    await expect(second).toContainText('Default');

    await second.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('City').fill('Victoria Island');
    await saveAddress(page, 'Edit address');
    await expect(
      page.getByTestId('address-card').filter({ hasText: 'Victoria Island' }),
    ).toHaveCount(1);

    await page
      .getByTestId('address-card')
      .filter({ hasText: '12 Marina Road' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await page
      .getByRole('group', { name: 'Remove this address?' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByText('Address removed.')).toBeVisible();
    await expect(page.getByTestId('address-card')).toHaveCount(1);
  });

  test('shows field errors for an incomplete address', async ({ page }) => {
    await registerAndWait(page, newTestEmail('address-invalid'));
    await page.goto('/account');
    await page.getByRole('button', { name: 'Add an address' }).click();
    await saveAddress(page);
    await expect(alertBox(page)).toContainText('Recipient name');
  });
});
