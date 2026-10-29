import { expect, test, type Locator, type Page } from '@playwright/test';

// The seeded outfits all have a real (tiny, playable) preview clip, so autoplay is tested for real.
// Normal motion settings are the default for these tests (no reduced-motion override).
const MAX_PLAYING = 4; // MAX_CONCURRENT_VIDEOS on a desktop

const cards = (page: Page): Locator => page.getByTestId('product-card');

interface CardState {
  index: number;
  inViewport: boolean;
  hasVideo: boolean;
  playing: boolean;
}

/** One entry per card: is it on screen, does it hold a <video>, is that video really playing. */
function cardStates(page: Page): Promise<CardState[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="product-card"]')].map((card, index) => {
      const rect = card.getBoundingClientRect();
      const video = card.querySelector('video');
      return {
        index,
        inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
        hasVideo: video !== null,
        playing: video !== null && !video.paused && video.readyState >= 2 && video.currentTime > 0,
      };
    }),
  );
}

async function untilSomethingPlays(page: Page): Promise<void> {
  await expect
    .poll(async () => (await cardStates(page)).filter((c) => c.playing).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test.describe('shop videos play by themselves (normal motion settings)', () => {
  test('visible cards start playing without a click, up to the pool limit; off-screen cards do not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/shop');
    await expect(cards(page)).toHaveCount(20);
    await untilSomethingPlays(page);
    // Let the pool settle, then check the rule.
    await expect
      .poll(async () => (await cardStates(page)).filter((c) => c.playing).length)
      .toBe(MAX_PLAYING);
    const states = await cardStates(page);
    const playing = states.filter((c) => c.playing);
    expect(playing.length).toBeLessThanOrEqual(MAX_PLAYING);
    for (const card of playing)
      expect(card.inViewport, `card ${card.index} plays on screen`).toBe(true);
    // Cards well below the fold hold no video at all.
    const belowFold = states.filter((c) => !c.inViewport && c.index >= 12);
    expect(belowFold.length).toBeGreaterThan(0);
    for (const card of belowFold)
      expect(card.hasVideo, `card ${card.index} is off screen`).toBe(false);
    // No play button where a video is playing, and no notice: nothing is paused.
    await expect(page.getByTestId('video-notice')).toHaveCount(0);
    await expect(page.locator('[data-testid="product-card"] video').first()).toHaveJSProperty(
      'muted',
      true,
    );
    await expect(page.getByRole('button', { name: 'Play video' })).toHaveCount(0);
  });

  test('scrolling hands the play slots to the cards now on screen and unloads the ones that left', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/shop');
    await untilSomethingPlays(page);
    await cards(page).nth(16).scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () => {
          const states = await cardStates(page);
          const playing = states.filter((c) => c.playing);
          return (
            playing.length > 0 &&
            playing.length <= MAX_PLAYING &&
            playing.every((c) => c.inViewport) &&
            states.slice(0, 4).every((c) => !c.hasVideo)
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('the home page hero and a phone-sized shop play without a click too', async ({ page }) => {
    await page.goto('/');
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const v = document.querySelector('section[data-hero] video');
            return (
              v !== null &&
              !(v as HTMLVideoElement).paused &&
              (v as HTMLVideoElement).currentTime > 0
            );
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/shop');
    await untilSomethingPlays(page);
    expect((await cardStates(page)).filter((c) => c.playing).length).toBeLessThanOrEqual(
      MAX_PLAYING,
    );
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shows posters, says why, and a tap starts that one video', async ({ page }) => {
    await page.goto('/shop');
    await expect(cards(page)).toHaveCount(20);
    await expect(page.getByTestId('video-notice')).toContainText(
      'Videos paused: reduced motion is on.',
    );
    expect(await page.locator('[data-testid="product-card"] video').count()).toBe(0);
    const buttons = page.getByRole('button', { name: 'Play video' });
    expect(await buttons.count()).toBeGreaterThan(0);
    await buttons.first().click();
    await expect
      .poll(async () => (await cardStates(page)).filter((c) => c.playing).length, {
        timeout: 15_000,
      })
      .toBe(1);
  });
});

test.describe('Data Saver and slow connections say why', () => {
  async function pretendConnection(
    page: Page,
    connection: { saveData: boolean; effectiveType: string },
  ) {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { ...value, addEventListener() {}, removeEventListener() {} },
      });
    }, connection);
  }

  test('Data Saver: posters, a label, and no video is requested', async ({ page }) => {
    await pretendConnection(page, { saveData: true, effectiveType: '4g' });
    const mp4: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('.mp4')) mp4.push(r.url());
    });
    await page.goto('/shop');
    await expect(page.getByTestId('video-notice')).toContainText(
      'Videos paused: Data Saver is on.',
    );
    await page.waitForTimeout(800);
    expect(mp4).toEqual([]);
  });

  test('a slow connection names the connection in the label', async ({ page }) => {
    await pretendConnection(page, { saveData: false, effectiveType: '3g' });
    await page.goto('/shop');
    await expect(page.getByTestId('video-notice')).toContainText(
      'Videos paused: slow connection (3g).',
    );
    expect(await page.locator('[data-testid="product-card"] video').count()).toBe(0);
  });

  test('a fast connection shows no label and plays', async ({ page }) => {
    await pretendConnection(page, { saveData: false, effectiveType: '4g' });
    await page.goto('/shop');
    await untilSomethingPlays(page);
    await expect(page.getByTestId('video-notice')).toHaveCount(0);
  });
});
