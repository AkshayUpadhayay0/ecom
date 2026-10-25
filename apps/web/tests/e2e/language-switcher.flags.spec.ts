import { expect, test, type Page } from '@playwright/test';
import { openMenu } from './helpers';

// Runs against the "flags" build: Pidgin switcher ON and a TEST-ONLY fixture key in the (otherwise
// empty) pcm dictionary: nav.shop reads "[test fixture] Shop". No real Pidgin text exists.
const FIXTURE_SHOP = '[test fixture] Shop';

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

test.describe('language switcher with the flag on', () => {
  test('keeps the URL, the query string and the typed search text', async ({ page }) => {
    await page.goto('/search?q=zanzibar&sort=name');
    const box = page.getByRole('searchbox', { name: 'Search outfits' });
    await expect(box).toHaveValue('zanzibar');

    // Typed but not yet submitted: the text must survive the switch.
    await box.fill('zanzibar agbada');
    await switchTo(page, 'Pidgin');
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
    await switchTo(page, 'Pidgin');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    expect(page.url()).toBe(before);
    await switchTo(page, 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(page.url()).toBe(before);
  });

  test('a key with a Pidgin entry uses it; every other key falls back to English', async ({
    page,
  }) => {
    await page.goto('/shop');
    const menuNav = (): ReturnType<Page['getByRole']> =>
      page.getByRole('dialog', { name: 'Menu' }).getByRole('navigation', { name: 'Menu' });
    await openMenu(page);
    await expect(menuNav()).toContainText('Shop');
    await page.keyboard.press('Escape');
    await switchTo(page, 'Pidgin');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');

    // The fixture key (nav.shop) is used in the side menu; keys without a Pidgin entry are English.
    const menu = await openMenu(page);
    await expect(menuNav()).toContainText(FIXTURE_SHOP);
    await expect(menu.getByRole('link', { name: 'Sign in' })).toBeVisible(); // nav.sign_in
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: 'Shop' })).toBeVisible(); // shop.title
    await expect(page.getByRole('button', { name: 'Open search' })).toBeVisible(); // header.open_search
    // Product names are data, never translated.
    await expect(page.getByTestId('product-card').first()).toBeVisible();

    // The choice is remembered (cookie) and can be undone.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pcm');
    await openMenu(page);
    await expect(menuNav()).toContainText(FIXTURE_SHOP);
    await page.keyboard.press('Escape');
    await switchTo(page, 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await openMenu(page);
    await expect(menuNav()).not.toContainText('[test fixture]');
  });
});
