import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { resetMediaSourcesCache } from '@/config/media-env';
import { MediaFrame, cardPosterUrl } from './media-frame';

const R2 = 'https://pub-0123456789abcdef.r2.dev';
const media = {
  posterUrl: `${R2}/media/video/v1/a1/poster.jpg`,
  previewUrl: `${R2}/media/video/v1/a1/preview.mp4`,
  mp4: [],
  dominantColor: '#112233',
};

class IdleObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): [] {
    return [];
  }
}

function stubPreferences(reduced: boolean): void {
  vi.stubGlobal('IntersectionObserver', IdleObserver);
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduced && query.includes('reduce'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

function renderFrame() {
  return render(
    <I18nProvider locale="en">
      <MediaFrame media={media} image={null} sizes="100vw" />
    </I18nProvider>,
  );
}

describe('MediaFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IdleObserver);
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', R2);
    resetMediaSourcesCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetMediaSourcesCache();
  });

  it('starts on the poster with no video loaded', () => {
    stubPreferences(false);
    const { container } = renderFrame();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(media.posterUrl);
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });

  it('renders an R2-style card (image renditions, no video) without throwing', () => {
    stubPreferences(false);
    const image = {
      dominantColor: '#abcdef',
      width: 1280,
      height: 1600,
      variants: [320, 640, 1280].map((w) => ({
        width: w,
        height: w * 1.25,
        url: `${R2}/media/image/i1/a1/w${w}.webp`,
      })),
    };
    const { container } = render(
      <I18nProvider locale="en">
        <MediaFrame media={null} image={image} sizes="50vw" />
      </I18nProvider>,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`${R2}/media/image/i1/a1/w640.webp`);
    expect(img?.getAttribute('srcset')).toBe(
      image.variants.map((v) => `${v.url} ${v.width}w`).join(', '),
    );
    expect(img?.getAttribute('sizes')).toBe('50vw');
  });

  it('renders no picture for a host that is not the configured media host', () => {
    stubPreferences(false);
    const { container } = render(
      <I18nProvider locale="en">
        <MediaFrame
          media={{ ...media, posterUrl: 'https://evil.example/media/video/v1/a1/poster.jpg' }}
          image={null}
          sizes="100vw"
        />
      </I18nProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('offers a play button instead of autoplay when reduced motion is on', () => {
    stubPreferences(true);
    const { container } = renderFrame();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
  });
});

describe('cardPosterUrl', () => {
  it('prefers the video poster, then an image variant, then nothing', () => {
    expect(cardPosterUrl(media, null)).toBe(media.posterUrl);
    const image = {
      dominantColor: null,
      width: 1000,
      height: 1000,
      variants: [
        { width: 320, height: 400, url: 'small' },
        { width: 640, height: 800, url: 'medium' },
        { width: 1280, height: 1600, url: 'large' },
      ],
    };
    expect(cardPosterUrl(null, image)).toBe('medium');
    expect(cardPosterUrl(null, null)).toBeNull();
  });
});
