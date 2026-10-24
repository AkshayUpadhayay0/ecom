import { expect, test, type Page } from '@playwright/test';

// Runs against the "flags" build: Pidgin switcher ON and a TEST-ONLY fixture key in the (otherwise
// empty) pcm dictionary: nav.shop reads "[test fixture] Shop". No real Pidgin text exists.
const FIXTURE_SHOP = '[test fixture] Shop';

const switcher = (page: Page) => page.getByRole('group', { name: 'Language' });

test.describe('language switcher with the flag on', () => {
  test('keeps the URL, the query string and the typed search text', async ({ page }) => {
    await page.goto('/search?q=zanzibar&sort=name');
    const box = page.getByRole('searchbox', { name: 'Search outfits' });
    await expect(box).toHaveValue('zanzibar');

    // Typed but not yet submitted: the text must survive the switch.
    await box.fill('zanzibar agbada');
    await switcher(page).getByRole('button', { name: 'Pidgin' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    await expect(box).toHaveValue('zanzibar agbada');

    // The debounced search may run meanwhile; either way the page is still the search page for the typed text.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/search');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toMatch(/^zanzibar/);
    await expect(box).toHaveValue('zanzibar agbada');
  });

  test('a plain page keeps its exact URL when the language changes', async ({ page }) => {
    await page.goto('/shop?sort=price_desc&type=trouser&page=1');
    const before = page.url();
    await switcher(page).getByRole('button', { name: 'Pidgin' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    expect(page.url()).toBe(before);
    await switcher(page).getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(page.url()).toBe(before);
  });

  test('a key with a Pidgin entry uses it; every other key falls back to English', async ({
    page,
  }) => {
    await page.goto('/shop');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toContainText('Shop');
    await switcher(page).getByRole('button', { name: 'Pidgin' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');

    // The fixture key (nav.shop) is used in the header and the footer.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toContainText(
      FIXTURE_SHOP,
    );
    await expect(page.getByRole('navigation', { name: 'Footer navigation' })).toContainText(
      FIXTURE_SHOP,
    );
    // Keys without a Pidgin entry are English.
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible(); // shop.title
    await expect(page.getByRole('searchbox', { name: 'Search outfits' })).toBeVisible(); // header.search_label
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible(); // nav.sign_in
    // Product names are data, never translated.
    await expect(page.getByTestId('product-card').first()).toBeVisible();

    // The choice is remembered (cookie) and can be undone.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toContainText(
      FIXTURE_SHOP,
    );
    await switcher(page).getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toContainText(
      '[test fixture]',
    );
  });
});
