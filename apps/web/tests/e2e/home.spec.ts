import { expect, test } from '@playwright/test';

test.describe('homepage', () => {
  test('renders hero text, the featured outfits and a link to Shop', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /shop/i }).first()).toBeVisible();
    await expect(page.getByTestId('product-card').first()).toBeVisible();
    // At most 8 outfits on desktop.
    expect(await page.getByTestId('product-card').count()).toBeLessThanOrEqual(8);
  });

  test.describe('without autoplay (reduced motion)', () => {
    test.use({ reducedMotion: 'reduce' });

    test('hero falls back to the poster and offers a play control', async ({ page }) => {
      await page.goto('/');
      const hero = page.getByRole('region', { name: 'Featured video' });
      await expect(hero.locator('img').first()).toBeVisible();
      await expect(hero.locator('video')).toHaveCount(0);
      await expect(hero.getByRole('button', { name: 'Play video' })).toBeVisible();
    });

    test('product cards stay on their posters', async ({ page }) => {
      await page.goto('/shop');
      await expect(page.getByTestId('product-card').first()).toBeVisible();
      await expect(page.locator('[data-testid="product-card"] video')).toHaveCount(0);
    });
  });
});
