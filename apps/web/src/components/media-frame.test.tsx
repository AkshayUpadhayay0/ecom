import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { MediaFrame, cardPosterUrl } from './media-frame';

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const media = {
  posterUrl: 'https://cdn.test/poster.jpg',
  previewUrl: 'https://cdn.test/preview.mp4',
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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on the poster with no video loaded', () => {
    stubPreferences(false);
    const { container } = renderFrame();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(media.posterUrl);
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
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
