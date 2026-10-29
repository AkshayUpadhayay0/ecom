import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEEDED } from './helpers';

// Product page media: autoplay with the shared video rules, a small stage that keeps the video's
// aspect ratio, and a thumbnail strip (video first) that switches the main view.
// Seeded: e2e-with-video = 720x1280 video + one photo; e2e-outfit-01 = video only;
// e2e-no-video = one photo only.
const VIDEO_ONLY = 'e2e-outfit-01';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const VIDEO_ASPECT = 720 / 1280;
const DESKTOP_WIDTH_MAX = 480;
const DESKTOP_HEIGHT_MAX = 0.75;
const PHONE_HEIGHT_MAX = 0.7;
const TOLERANCE = 2;

const stage = (page: Page): Locator => page.locator('.product-media-stage');
const video = (page: Page): Locator => page.locator('main video');
const strip = (page: Page): Locator => page.getByRole('group', { name: 'Product media' });

async function isPlaying(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLVideoElement>('main video');
    return (
      element !== null && !element.paused && element.readyState >= 2 && element.currentTime > 0
    );
  });
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

function naturalWidth(locator: Locator): Promise<number> {
  return locator.evaluate((el) => (el as HTMLImageElement).naturalWidth);
}

test.describe('product video autoplays (normal motion settings)', () => {
  test('plays by itself, muted, with our overlay and no native controls', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/products/${SEEDED.withVideo}`);
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
    await expect(video(page)).not.toHaveAttribute('controls', /.*/);
    await expect(video(page)).toHaveAttribute('loop', '');
    await expect(video(page)).toHaveJSProperty('muted', true);
    await expect(page.getByTestId('video-notice')).toHaveCount(0);
  });

  test('the mute button unmutes and mutes; a tap pauses and plays', async ({ page }) => {
    await page.goto(`/products/${SEEDED.withVideo}`);
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);

    await page.getByRole('button', { name: 'Unmute video' }).click();
    await expect(video(page)).toHaveJSProperty('muted', false);
    await page.getByRole('button', { name: 'Mute video' }).click();
    await expect(video(page)).toHaveJSProperty('muted', true);

    await page.getByRole('button', { name: 'Pause video' }).click();
    await expect.poll(() => isPlaying(page)).toBe(false);
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
  });

  test('the quality switcher is tucked away, automatic by default', async ({ page }) => {
    await page.goto(`/products/${SEEDED.withVideo}`);
    const details = page.locator('main details');
    await expect(details).not.toHaveAttribute('open', /.*/);
    await details.locator('summary').click();
    await expect(details.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await details.getByRole('button', { name: '720p' }).click();
    await expect(details.getByRole('button', { name: '720p' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(video(page)).toHaveAttribute('src', /720p\.mp4/);
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
  });
});

test.describe('product video, visitor settings', () => {
  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('shows the poster, says why, and a tap starts it', async ({ page }) => {
      await page.goto(`/products/${SEEDED.withVideo}`);
      await expect(page.getByTestId('video-notice')).toContainText('reduced motion');
      await expect(video(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Play video' }).click();
      await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
    });
  });
});

test.describe('product media size and layout', () => {
  test('desktop: at most 480 px wide, at most 75vh tall, own aspect ratio, sticky', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/products/${SEEDED.withVideo}`);
    const rect = await box(stage(page));
    expect(rect.width).toBeLessThanOrEqual(DESKTOP_WIDTH_MAX + TOLERANCE);
    expect(rect.height).toBeLessThanOrEqual(DESKTOP.height * DESKTOP_HEIGHT_MAX + TOLERANCE);
    expect(rect.width / rect.height).toBeCloseTo(VIDEO_ASPECT, 2); // not cropped, not stretched
    const column = stage(page).locator('xpath=ancestor::div[contains(@class,"sticky")][1]');
    await expect(column).toHaveCSS('position', 'sticky');
  });

  test('a short viewport shrinks the video, never the ratio', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.goto(`/products/${SEEDED.withVideo}`);
    const rect = await box(stage(page));
    expect(rect.height).toBeLessThanOrEqual(600 * DESKTOP_HEIGHT_MAX + TOLERANCE);
    expect(rect.width / rect.height).toBeCloseTo(VIDEO_ASPECT, 2);
  });

  test('phone: full width, at most 70vh tall', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(`/products/${SEEDED.withVideo}`);
    const rect = await box(stage(page));
    expect(rect.height).toBeLessThanOrEqual(PHONE.height * PHONE_HEIGHT_MAX + TOLERANCE);
    const article = await box(page.locator('main article'));
    expect(rect.width).toBeGreaterThan(article.width - 40); // the full column width
  });

  test('nothing moves while the video loads and starts', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/products/${SEEDED.withVideo}`);
    const before = await box(stage(page));
    const heading = page.getByRole('heading', { level: 1 });
    const headingBefore = await box(heading);
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
    expect(await box(stage(page))).toEqual(before);
    expect(await box(heading)).toEqual(headingBefore);
  });
});

test.describe('product photos and the thumbnail strip', () => {
  test('photos are really visible: loaded and sized, not an empty coloured box', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/products/${SEEDED.withVideo}`);
    const thumbs = strip(page).getByRole('button');
    await expect(thumbs).toHaveCount(2); // the video first, then the photo
    await expect(thumbs.nth(0)).toHaveAccessibleName('Product video');
    await expect(thumbs.nth(1)).toHaveAccessibleName('Photo 1 of 1');
    const thumbImages = strip(page).locator('img');
    await expect(thumbImages).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect.poll(() => naturalWidth(thumbImages.nth(i))).toBeGreaterThan(0);
    }
  });

  test('choosing a thumbnail switches the main view between the video and the photo', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/products/${SEEDED.withVideo}`);
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
    const thumbs = strip(page).getByRole('button');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');

    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(video(page)).toHaveCount(0);
    const photo = stage(page).getByRole('img', { name: 'E2E Video Kaftan (1)' });
    await expect(photo).toBeVisible();
    await expect.poll(() => naturalWidth(photo)).toBeGreaterThan(0);
    // the stage keeps its size when the view changes
    const rect = await box(stage(page));
    expect(rect.width / rect.height).toBeCloseTo(VIDEO_ASPECT, 2);

    await thumbs.nth(0).click();
    await expect.poll(() => isPlaying(page), { timeout: 15_000 }).toBe(true);
  });

  test('works with the keyboard alone', async ({ page }) => {
    await page.goto(`/products/${SEEDED.withVideo}`);
    const thumbs = strip(page).getByRole('button');
    await thumbs.nth(1).focus();
    await expect(thumbs.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(thumbs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(video(page)).toHaveCount(0);
    await thumbs.nth(0).focus();
    await page.keyboard.press('Space');
    await expect(thumbs.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(video(page)).toHaveCount(1);
  });

  test('a product with a video and no photos shows no strip and no empty box', async ({ page }) => {
    await page.goto(`/products/${VIDEO_ONLY}`);
    await expect(video(page)).toHaveCount(1);
    await expect(strip(page)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Photos' })).toHaveCount(0);
    await expect(page.locator('main [role="img"]')).toHaveCount(0);
  });

  test('a product with one photo and no video shows the photo, no strip', async ({ page }) => {
    await page.goto(`/products/${SEEDED.noVideo}`);
    await expect(video(page)).toHaveCount(0);
    await expect(strip(page)).toHaveCount(0);
    const photo = stage(page).getByRole('img', { name: /E2E No Video Shirt/ });
    await expect(photo).toBeVisible();
    await expect.poll(() => naturalWidth(photo)).toBeGreaterThan(0);
  });
});
