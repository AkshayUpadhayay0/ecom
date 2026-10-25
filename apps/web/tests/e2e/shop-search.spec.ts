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

  test('matches the clothing type as well as the name, across the whole catalogue', async ({
    page,
  }) => {
    // The agbada's name has no "trouser" in it and it is the oldest product (beyond page 1 of the
    // shop): only its clothing type can match this word.
    await page.goto('/search?q=trouser');
    await expect(page.getByRole('link', { name: SEEDED.zanzibarName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'E2E Outfit 02' })).toBeVisible();
    // A word from the name alone still works.
    await page.goto('/search?q=zanzibar');
    await expect(page.getByRole('link', { name: SEEDED.zanzibarName })).toBeVisible();
  });

  test('the header search opens an overlay; Enter shows the results page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open search' }).click();
    const overlay = page.getByRole('dialog', { name: 'Search' });
    await expect(overlay).toBeVisible();
    const box = overlay.getByRole('searchbox', { name: 'Search outfits' });
    await expect(box).toBeFocused();
    await box.fill('zanzibar');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=zanzibar$/);
    await expect(overlay).toBeHidden();
    await expect(page.getByRole('link', { name: SEEDED.zanzibarName })).toBeVisible();
  });

  test('a search with no match through the overlay shows the exact empty message', async ({
    page,
  }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Open search' }).click();
    await page
      .getByRole('dialog', { name: 'Search' })
      .getByRole('searchbox', { name: 'Search outfits' })
      .fill('qzxqzxqzx');
    await page.keyboard.press('Enter');
    await expect(page.getByText(NO_RESULTS_TEXT, { exact: true })).toBeVisible();
  });

  test('Esc closes the search overlay and returns focus to the search button', async ({ page }) => {
    await page.goto('/shop');
    const opener = page.getByRole('button', { name: 'Open search' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('typing in the search page box still searches (debounced) through the URL', async ({
    page,
  }) => {
    await page.goto('/search');
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
