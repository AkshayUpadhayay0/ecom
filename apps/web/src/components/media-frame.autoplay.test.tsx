import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMediaSourcesCache } from '@/config/media-env';
import { I18nProvider } from '@/lib/i18n/provider';
import { resetPausedNotices, usePausedNotice } from '@/lib/video/video-notice';
import { MediaFrame } from './media-frame';

const R2 = 'https://pub-0123456789abcdef.r2.dev';
const media = {
  posterUrl: `${R2}/media/video/v1/a1/poster.jpg`,
  previewUrl: `${R2}/media/video/v1/a1/preview.mp4`,
  mp4: [],
  dominantColor: '#112233',
};

/** An IntersectionObserver that reports every observed element as visible at once. */
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(element: Element): void {
    queueMicrotask(() => {
      this.callback(
        [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }
  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): [] {
    return [];
  }
}

function stubBrowser(options: { reduced?: boolean; saveData?: boolean; type?: string } = {}): void {
  vi.stubGlobal('IntersectionObserver', VisibleObserver);
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: Boolean(options.reduced) && query.includes('reduce'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData: options.saveData ?? false, effectiveType: options.type ?? '4g' },
  });
}

function rejection(name: string): Promise<void> {
  return Promise.reject(Object.assign(new Error(name), { name }));
}

function Notice() {
  const notice = usePausedNotice();
  return <p data-testid="notice">{notice ? `${notice.reason}|${notice.detail ?? ''}` : 'none'}</p>;
}

function renderCard(strict = false) {
  const tree = (
    <I18nProvider locale="en">
      <MediaFrame media={media} image={null} sizes="100vw" />
      <Notice />
    </I18nProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('MediaFrame autoplay', () => {
  const play = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', R2);
    resetMediaSourcesCache();
    resetPausedNotices();
    play.mockReset();
    // jsdom does not implement media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetMediaSourcesCache();
  });

  it('plays a visible card by itself and shows no play button', async () => {
    stubBrowser();
    play.mockResolvedValue(undefined);
    const { container } = renderCard();
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    expect(screen.getByTestId('notice')).toHaveTextContent('none');
  });

  it('REGRESSION: a play() that is aborted while starting (React StrictMode remount) does not turn autoplay off', async () => {
    stubBrowser();
    // The first start is interrupted by the unload of the first mount; later starts work.
    play.mockImplementationOnce(() => rejection('AbortError')).mockResolvedValue(undefined);
    const { container } = renderCard(true);
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    expect(container.querySelector('video')).not.toBeNull();
    expect(screen.getByTestId('notice')).toHaveTextContent('none');
    // The remount must leave the video with its source (the first unload removed it).
    expect(container.querySelector('video')?.getAttribute('src')).toBe(media.previewUrl);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('an AbortError alone, with no remount, is also ignored', async () => {
    stubBrowser();
    play.mockImplementation(() => rejection('AbortError'));
    const { container } = renderCard();
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });

  it('when the browser really refuses autoplay (NotAllowedError) it shows the poster, a play button and says why', async () => {
    stubBrowser();
    play.mockImplementation(() => rejection('NotAllowedError'));
    renderCard();
    expect(await screen.findByRole('button', { name: 'Play video' })).toBeInTheDocument();
    expect(screen.getByTestId('notice')).toHaveTextContent('autoplay_blocked');
  });

  it('a tap on the play button starts it even after a refusal', async () => {
    stubBrowser();
    play.mockImplementationOnce(() => rejection('NotAllowedError')).mockResolvedValue(undefined);
    const { container } = renderCard();
    const button = await screen.findByRole('button', { name: 'Play video' });
    act(() => {
      button.click();
    });
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    expect(screen.getByTestId('notice')).toHaveTextContent('none');
  });

  it('reduced motion: poster and play button, and the notice says reduced motion', async () => {
    stubBrowser({ reduced: true });
    const { container } = renderCard();
    expect(await screen.findByRole('button', { name: 'Play video' })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('notice')).toHaveTextContent('reduced_motion');
    });
  });

  it('Data Saver: poster and play button, and the notice says Data Saver', async () => {
    stubBrowser({ saveData: true });
    renderCard();
    expect(await screen.findByRole('button', { name: 'Play video' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('notice')).toHaveTextContent('save_data');
    });
  });

  it('a slow connection (3g): poster and play button, and the notice names the connection', async () => {
    stubBrowser({ type: '3g' });
    renderCard();
    expect(await screen.findByRole('button', { name: 'Play video' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('notice')).toHaveTextContent('slow|3g');
    });
  });
});
