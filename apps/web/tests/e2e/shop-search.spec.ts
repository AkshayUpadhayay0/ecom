import { expect, test } from '@playwright/test';
import { NO_RESULTS_TEXT, SEEDED, apiProducts } from './helpers';

test.describe('shop', () => {
  test('shows the API page size per page and paginates through the URL', async ({ page }) => {
    const first = await apiProducts();
    expect(first.meta.totalPages).toBeGreaterThan(1); // the seed has more than one page

    await page.goto('/shop');
    await expect(page.getByTestId('product-card')).toHaveCount(first.meta.pageSize);
    expect(first.meta.pageSize).toBe(20);

    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page).toHaveURL(/\/shop\?page=2$/);
    const second = await apiProducts('?page=2');
    await expect(page.getByTestId('product-card')).toHaveCount(second.data.length);
    await expect(page.getByText(`Page 2 of ${first.meta.totalPages}`)).toBeVisible();
  });

  test('clothing-type filter and sort live in the URL', async ({ page }) => {
    await page.goto('/shop');
    await page
      .getByRole('navigation', { name: 'Clothing type' })
      .getByRole('link', { name: 'Trouser' })
      .click();
    await expect(page).toHaveURL(/type=trouser/);
    const trousers = await apiProducts('?clothingType=trouser');
    await expect(page.getByText(`${trousers.meta.total} outfits`)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Sort by' })
      .getByRole('link', { name: 'Price: low to high' })
      .click();
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page).toHaveURL(/type=trouser/);
    const cheapest = await apiProducts('?clothingType=trouser&sort=price_asc');
    await expect(page.getByTestId('product-card').first()).toContainText(
      cheapest.data[0]?.name ?? '',
    );
  });

  test('marks sold-out outfits', async ({ page }) => {
    await page.goto('/search?q=sold+out');
    const card = page.getByTestId('product-card').filter({ hasText: SEEDED.soldOutName });
    await expect(card).toContainText('Out of stock');
  });
});

test.describe('search', () => {
  test('finds an outfit that is beyond page 1 of the shop', async ({ page }) => {
    await page.goto('/search?q=zanzibar');
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await expect(page.getByRole('link', { name: SEEDED.zanzibarName })).toBeVisible();
  });

  test('typing in the header box searches (debounced) through the URL', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: 'Search outfits' }).fill('zanzibar');
    await expect(page).toHaveURL(/\/search\?q=zanzibar$/);
    await expect(page.getByRole('link', { name: SEEDED.zanzibarName })).toBeVisible();
  });

  test('shows the exact empty message for a nonsense word', async ({ page }) => {
    await page.goto('/search?q=qzxqzxqzx');
    await expect(page.getByText(NO_RESULTS_TEXT, { exact: true })).toBeVisible();
  });

  test('renders user input as text, never as markup', async ({ page }) => {
    const payload = '<img src=x onerror=alert(1)>';
    let dialog = false;
    page.on('dialog', async (d) => {
      dialog = true;
      await d.dismiss();
    });
    await page.goto(`/search?q=${encodeURIComponent(payload)}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(payload);
    expect(dialog).toBe(false);
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
  });

  test('trims and limits very long input', async ({ page }) => {
    await page.goto(`/search?q=${'a'.repeat(300)}`);
    await expect(page.getByText(NO_RESULTS_TEXT, { exact: true })).toBeVisible();
  });
});
