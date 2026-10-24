import { describe, expect, it } from 'vitest';
import { isAllowedMediaUrl, mediaOriginsOf, mediaSourcesFrom, remotePatternsOf } from './media';

const R2 = 'https://pub-cadd93810cb64538b0c5b7e066068df8.r2.dev';
const sources = mediaSourcesFrom({ mediaBaseUrl: R2, apiBaseUrl: 'http://localhost:4000' });

describe('media allow-list', () => {
  it('allows R2 renditions and the API local-storage media folder', () => {
    expect(isAllowedMediaUrl(`${R2}/media/image/i/a1/w640.webp`, sources)).toBe(true);
    expect(
      isAllowedMediaUrl(
        'http://localhost:4000/api/v1/media-local/public/media/image/i/a1/w640.webp',
        sources,
      ),
    ).toBe(true);
  });

  it('rejects an unknown host, other ports, other paths, tricks', () => {
    expect(isAllowedMediaUrl('https://evil.example/media/a.webp', sources)).toBe(false);
    expect(isAllowedMediaUrl(`${R2}.evil.example/media/a.webp`, sources)).toBe(false);
    expect(isAllowedMediaUrl(`${R2}/private/a.webp`, sources)).toBe(false);
    expect(isAllowedMediaUrl(`${R2}/media/../private/a.webp`, sources)).toBe(false);
    expect(isAllowedMediaUrl(`${R2}/media/%2e%2e/private/a.webp`, sources)).toBe(false);
    expect(isAllowedMediaUrl('http://localhost:4000/api/v1/auth/login', sources)).toBe(false);
    expect(
      isAllowedMediaUrl('http://localhost:4001/api/v1/media-local/public/media/a.webp', sources),
    ).toBe(false);
    expect(
      isAllowedMediaUrl(`http://pub-cadd93810cb64538b0c5b7e066068df8.r2.dev/media/a.webp`, sources),
    ).toBe(false);
    expect(
      isAllowedMediaUrl(
        'https://user:pw@pub-cadd93810cb64538b0c5b7e066068df8.r2.dev/media/a',
        sources,
      ),
    ).toBe(false);
    expect(isAllowedMediaUrl('javascript:alert(1)', sources)).toBe(false);
    expect(isAllowedMediaUrl('not a url', sources)).toBe(false);
  });

  it('builds remotePatterns with host and media path only', () => {
    expect(remotePatternsOf(sources)).toEqual([
      {
        protocol: 'https',
        hostname: 'pub-cadd93810cb64538b0c5b7e066068df8.r2.dev',
        pathname: '/media/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '4000',
        pathname: '/api/v1/media-local/public/media/**',
      },
    ]);
    expect(mediaOriginsOf(sources)).toEqual([R2, 'http://localhost:4000']);
  });

  it('supports a custom domain with a path prefix and extra bases; ignores invalid values', () => {
    const custom = mediaSourcesFrom({
      mediaBaseUrl: 'https://cdn.example.com/assets/',
      extraBaseUrls: 'https://other.example.com, nonsense',
      apiBaseUrl: 'http://localhost:4000',
    });
    expect(isAllowedMediaUrl('https://cdn.example.com/assets/media/x.webp', custom)).toBe(true);
    expect(isAllowedMediaUrl('https://cdn.example.com/media/x.webp', custom)).toBe(false);
    expect(isAllowedMediaUrl('https://other.example.com/media/x.webp', custom)).toBe(true);
  });
});
