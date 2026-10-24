import { expect, test, type Page } from '@playwright/test';
import {
  DIRECT_PRODUCT,
  PROFILE_PRODUCT,
  cartCount,
  fitDialog,
  reachRecommendation,
  signIn,
  signUp,
} from './shopping';

const closeDrawer = (page: Page) => page.getByRole('button', { name: 'Close cart' }).click();

async function addDecidedOutfit(page: Page): Promise<void> {
  await page.goto(PROFILE_PRODUCT);
  await reachRecommendation(page, '42');
  await fitDialog(page).getByRole('button', { name: 'Use size L' }).click();
  await expect(page.getByTestId('selected-size')).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
}

test.describe('cart', () => {
  test('the cart page needs a login', async ({ page }) => {
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/login\?next=%2Fcart$/);
  });

  test('add a Find My Size outfit, change quantity, then remove it', async ({ page }) => {
    await signUp(page, 'cart-flow');
    await addDecidedOutfit(page);
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await closeDrawer(page);

    await page.goto('/cart');
    const line = page.getByTestId('cart-line');
    await expect(line).toContainText('Size L');
    await expect(line).toContainText('Recommended for your measurements');
    await expect(page.getByRole('button', { name: /Checkout/ })).toBeDisabled();

    const subtotal = page.getByTestId('cart-subtotal');
    await expect(subtotal).toHaveText('₦42,000');
    await page.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(page.getByTestId('line-qty')).toHaveText('2');
    await expect(subtotal).toHaveText('₦84,000');
    await page.getByRole('button', { name: /Decrease quantity/ }).click();
    await expect(page.getByTestId('line-qty')).toHaveText('1');

    await page.getByRole('button', { name: /^Remove E2E Video Kaftan/ }).click();
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('0');
  });

  test('reopen Find my size on a line: the size can change to another one', async ({ page }) => {
    await signUp(page, 'cart-refit');
    await addDecidedOutfit(page);
    await closeDrawer(page);
    await page.goto('/cart');

    await page.getByRole('button', { name: 'Reopen Find my size' }).click();
    const dialog = fitDialog(page);
    await expect(dialog).toBeVisible();
    // Measurements are entered again (decisions are never edited, a new one is created).
    await dialog.getByLabel(/Chest/).fill('42');
    await dialog.getByLabel(/Shoulder/).fill('17');
    await dialog.getByLabel(/Sleeve/).fill('24');
    await dialog.getByLabel(/length/i).fill('28');
    await dialog.getByRole('button', { name: 'See my size' }).click();
    await dialog.getByRole('radio', { name: /XL/ }).check();
    await dialog.getByRole('button', { name: 'Use size XL instead' }).click();

    const line = page.getByTestId('cart-line');
    await expect(line).toContainText('Size XL');
    await expect(line).toContainText('Your choice (we recommended L)');
  });

  test('stock limit: asking for more than is available is refused and rolled back', async ({
    page,
  }) => {
    await signUp(page, 'cart-stock');
    await addDecidedOutfit(page); // size L has 2 in stock
    await closeDrawer(page);
    await page.goto('/cart');
    await page.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(page.getByTestId('line-qty')).toHaveText('2');
    await page.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(page.locator('main [role=alert]')).toContainText(
      'There is not enough stock for that quantity.',
    );
    await expect(page.getByTestId('line-qty')).toHaveText('2'); // rolled back
  });

  test('the per-line limit comes from the API and is explained in plain words', async ({
    page,
  }) => {
    await signUp(page, 'cart-limit');
    await page.goto(DIRECT_PRODUCT);
    await page.getByRole('radio', { name: /^M/ }).check();
    await page.getByLabel('Quantity').fill('10');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await closeDrawer(page);
    await page.goto('/cart');
    await expect(page.getByTestId('line-qty')).toHaveText('10');
    await page.getByRole('button', { name: /Increase quantity/ }).click();
    await expect(page.locator('main [role=alert]')).toContainText(
      'You can add at most 10 of one item.',
    );
    await expect(page.getByTestId('line-qty')).toHaveText('10');
  });

  test('the cart lives on the server: it survives sign out and sign in', async ({ page }) => {
    const email = await signUp(page, 'cart-persist');
    await page.goto(DIRECT_PRODUCT);
    await page.getByRole('radio', { name: /^M/ }).check();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await closeDrawer(page);
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('cart-count')).toHaveCount(0);

    await signIn(page, email);
    await expect.poll(() => cartCount(page)).toBe(1);
    await page.goto('/cart');
    await expect(page.getByTestId('cart-line')).toContainText('E2E Direct Shirt');
  });
});

test.describe('direct size selection (products without a measurement profile)', () => {
  test('Add to cart waits for a size, and out-of-stock sizes cannot be chosen', async ({
    page,
  }) => {
    await signUp(page, 'direct');
    await page.goto(DIRECT_PRODUCT);
    await expect(
      page.getByText('This outfit has no Blueprint fit. Pick the size you want.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    await expect(page.getByText('Choose a size to continue.')).toBeVisible();
    await expect(page.getByRole('radio', { name: /^XL/ })).toBeDisabled();

    await page.getByRole('radio', { name: /^L/ }).check();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByTestId('cart-line')).toContainText('Size L');
  });

  test('a logged-out shopper who picked a size is brought back to it after login', async ({
    page,
  }) => {
    await page.goto(DIRECT_PRODUCT);
    await page.getByRole('radio', { name: /^L/ }).check();
    // Radios are shown to everyone; Add to cart sends signed-out shoppers to login.
    await page.getByRole('link', { name: 'Add to cart' }).click();
    await expect(page).toHaveURL(
      /\/login\?next=%2Fproducts%2Fe2e-direct-shirt%3Fintent%3Dadd%26size%3DL/,
    );

    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Full name').fill('Ada Tester');
    await page.getByLabel('Email').fill(`e2e-direct-return-${Date.now()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('Correct-Horse-Battery-9');
    await page.getByLabel('I accept the terms and conditions.').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/products\/e2e-direct-shirt$/);
    await expect(page.getByRole('radio', { name: /^L/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  test('a profile product cannot be added without a decision (no size picker at all)', async ({
    page,
  }) => {
    await signUp(page, 'profile-guard');
    await page.goto(PROFILE_PRODUCT);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    await expect(page.getByText(/sized from your body measurements/)).toBeVisible();
  });
});
