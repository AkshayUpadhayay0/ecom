import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMediaSourcesCache } from '@/config/media-env';
import { MediaImage } from './media-image';

describe('MediaImage with a URL outside the allowed media locations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetMediaSourcesCache();
  });

  it('renders nothing and says why, naming the setting that fixes it (once per origin)', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', '');
    resetMediaSourcesCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const url = 'https://pub-example.r2.dev/media/image/a/w640.webp';

    const first = render(<MediaImage src={url} alt="x" sizes="100vw" />);
    expect(first.container.querySelector('img')).toBeNull();
    render(<MediaImage src={url} alt="x" sizes="100vw" />);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('NEXT_PUBLIC_MEDIA_BASE_URL');
    expect(String(warn.mock.calls[0]?.[0])).toContain('https://pub-example.r2.dev');
  });

  it('renders the picture when the media base URL is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', 'https://pub-example.r2.dev');
    resetMediaSourcesCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = render(
      <MediaImage src="https://pub-example.r2.dev/media/image/a/w640.webp" alt="x" sizes="100vw" />,
    );
    expect(view.container.querySelector('img')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
