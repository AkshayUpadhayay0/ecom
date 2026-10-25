import { expect, test, type Locator } from '@playwright/test';
import { openMenu } from './helpers';
import { signUp } from './shopping';

/**
 * True when keyboard focus sits on page content behind the modal menu. Focus may legitimately
 * leave the document for the browser's own controls (activeElement is then the body).
 */
function focusEscapedMenu(menu: Locator): Promise<boolean> {
  return menu.evaluate((dialog) => {
    const active = document.activeElement;
    return !dialog.contains(active) && active !== document.body && active !== null;
  });
}

test.describe('header', () => {
  test('is transparent over the home hero and turns solid once the hero scrolls under it', async ({
    page,
  }) => {
    await page.goto('/');
    const header = page.locator('header.site-header');
    await expect(header).toHaveAttribute('data-state', 'over-hero');
    await page.mouse.wheel(0, 2000);
    await expect(header).toHaveAttribute('data-state', 'solid');
    await page.mouse.wheel(0, -4000);
    await expect(header).toHaveAttribute('data-state', 'over-hero');
  });

  test('is solid on every other page and does not cover the content', async ({ page }) => {
    await page.goto('/shop');
    const header = page.locator('header.site-header');
    await expect(header).toHaveAttribute('data-state', 'solid');
    const bar = await header.boundingBox();
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(bar).not.toBeNull();
    expect(heading).not.toBeNull();
    expect((heading?.y ?? 0) >= (bar?.height ?? 0)).toBe(true);
  });

  test('has the menu button on the left, the wordmark in the middle and icons on the right', async ({
    page,
  }) => {
    await page.goto('/shop');
    const menu = await page.getByRole('button', { name: 'Open menu' }).boundingBox();
    const logo = await page.getByRole('link', { name: /home$/ }).boundingBox();
    const search = await page.getByRole('button', { name: 'Open search' }).boundingBox();
    const account = await page.getByRole('link', { name: 'Sign in' }).boundingBox();
    const viewport = page.viewportSize()?.width ?? 0;
    expect((menu?.x ?? viewport) < (logo?.x ?? 0)).toBe(true);
    expect(Math.abs((logo?.x ?? 0) + (logo?.width ?? 0) / 2 - viewport / 2)).toBeLessThan(8);
    expect((search?.x ?? 0) > (logo?.x ?? 0)).toBe(true);
    expect((account?.x ?? 0) > (search?.x ?? 0)).toBe(true);
  });

  test('signed in: the Account icon and the cart appear', async ({ page }) => {
    await signUp(page, 'nav');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Cart/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });
});

test.describe('side menu', () => {
  test('lists Shop, the clothing types and Sign in; no language switcher while the flag is off', async ({
    page,
  }) => {
    await page.goto('/');
    const menu = await openMenu(page);
    await expect(menu.getByRole('link', { name: 'Shop' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Sign in' })).toBeVisible();
    const types = menu.getByRole('list', { name: 'Clothing type' }).getByRole('link');
    expect(await types.count()).toBeGreaterThan(0);
    await expect(menu.getByRole('group', { name: 'Language' })).toHaveCount(0);
  });

  test('a clothing type opens the filtered shop and closes the menu', async ({ page }) => {
    await page.goto('/');
    const menu = await openMenu(page);
    await menu.getByRole('list', { name: 'Clothing type' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/shop\?type=/);
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  });

  test('Esc closes it and focus returns to the menu button', async ({ page }) => {
    await page.goto('/shop');
    const opener = page.getByRole('button', { name: 'Open menu' });
    await openMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('a click on the backdrop closes it', async ({ page }) => {
    await page.goto('/shop');
    await openMenu(page);
    await page.mouse.click((page.viewportSize()?.width ?? 1280) - 5, 300);
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  });

  test('keeps keyboard focus inside while open', async ({ page }) => {
    await page.goto('/shop');
    const menu = await openMenu(page);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await focusEscapedMenu(menu), `focus stays in the menu after ${i + 1} Tab`).toBe(
        false,
      );
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusEscapedMenu(menu), `focus stays in the menu after ${i + 1} Shift+Tab`).toBe(
        false,
      );
    }
  });

  test('slides in from the left, full height', async ({ page }) => {
    await page.goto('/shop');
    const menu = await openMenu(page);
    await expect(async () => {
      const box = await menu.boundingBox();
      expect(box?.x).toBe(0);
      expect(box?.y).toBe(0);
      expect(box?.height).toBe(page.viewportSize()?.height);
    }).toPass();
  });

  test('signed in, the menu offers Account instead of Sign in', async ({ page }) => {
    await signUp(page, 'menu');
    const menu = await openMenu(page);
    await expect(menu.getByRole('link', { name: 'Account' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });
});

test.describe('footer', () => {
  test('is one line: rights notice only, no About block, no seal, no link list', async ({
    page,
  }) => {
    await page.goto('/shop');
    const footer = page.locator('footer');
    await expect(footer).toContainText('Urban Ìbílé');
    await expect(footer.getByText(/about/i)).toHaveCount(0);
    await expect(footer.locator('img')).toHaveCount(0);
    // Support contacts and policies were never supplied in the test data: nothing to link.
    await expect(footer.getByRole('navigation')).toHaveCount(0);
    expect((await footer.boundingBox())?.height ?? 999).toBeLessThan(120);
  });

  test('policy pages that were not supplied are not found, and are not linked', async ({
    page,
  }) => {
    const response = await page.goto('/policies/privacy');
    expect(response?.status()).toBe(404);
    expect((await page.goto('/policies/footer.about'))?.status()).toBe(404);
    await page.goto('/');
    const menu = await openMenu(page);
    await expect(menu.getByRole('link', { name: 'Privacy' })).toHaveCount(0);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the menu still opens and closes without relying on animation', async ({ page }) => {
    await page.goto('/shop');
    await openMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  });
});
