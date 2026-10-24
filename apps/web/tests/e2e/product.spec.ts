import { expect, test } from '@playwright/test';
import { SEEDED } from './helpers';

test.describe('product page', () => {
  test('unknown product is a real 404', async ({ page }) => {
    const response = await page.goto('/products/this-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('unknown URL is a styled 404 inside the site layout', async ({ page }) => {
    const response = await page.goto('/no/such/page');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('link', { name: 'Back to shop' })).toBeVisible();
  });

  test('a product with no ready video shows its image and no player', async ({ page }) => {
    await page.goto(`/products/${SEEDED.noVideo}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E No Video Shirt' })).toBeVisible();
    await expect(page.locator('main video')).toHaveCount(0);
    await expect(page.getByRole('img', { name: /E2E No Video Shirt/ })).toBeVisible();
    await expect(page.getByText('This outfit has no Blueprint fit.')).toBeVisible();
  });

  test('a product with a video shows a player, sizes with availability and the Blueprint note', async ({
    page,
  }) => {
    await page.goto(`/products/${SEEDED.withVideo}`);
    const video = page.locator('main video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).not.toHaveAttribute('autoplay', /.*/);

    const sizes = page.getByRole('region', { name: 'Sizes' });
    await expect(sizes.getByText('Out of stock')).toBeVisible(); // M
    await expect(sizes.getByText('Low stock')).toBeVisible(); // L
    await expect(sizes.getByText('In stock', { exact: true })).toBeVisible(); // XL
    await expect(page.getByText(/Blueprint fit: your size is worked out/)).toBeVisible();
    // Signed out: a sign-in prompt instead of fitting or cart buttons.
    await expect(page.getByRole('button', { name: /cart|find my size/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in to continue' })).toBeVisible();
  });

  test('has product JSON-LD (NGN, availability) and Open Graph with the poster', async ({
    page,
  }) => {
    await page.goto(`/products/${SEEDED.withVideo}`);
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(raw ?? '{}') as {
      '@type': string;
      offers: { priceCurrency: string; price: string; availability: string };
    };
    expect(data['@type']).toBe('Product');
    expect(data.offers.priceCurrency).toBe('NGN');
    expect(data.offers.price).toBe('42000.00');
    expect(data.offers.availability).toBe('https://schema.org/InStock');

    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(ogImage).toMatch(/poster\.jpg/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/products\/e2e-with-video$/,
    );
  });
});
