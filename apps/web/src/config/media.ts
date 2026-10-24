/**
 * Which URLs the website may load product media from. Used by next.config (CSP and
 * images.remotePatterns) and at render time by MediaImage, so a media URL that does not come from
 * the configured media host, or does not sit under the media path, is never put into the page.
 *
 * Media lives in two places, both configured, never hard-coded:
 *  - the public media base URL (R2 public URL in development, the custom CDN domain in
 *    production): the same value the API uses as R2_PUBLIC_BASE_URL. Objects are `<base>/media/...`.
 *  - the API itself, when it serves media from local storage (development / tests only):
 *    `<api>/api/v1/media-local/public/media/...`.
 */
export const MEDIA_KEY_PREFIX = 'media/';
/** Where the API serves local-storage media (MEDIA_STORAGE_DRIVER=local). */
export const LOCAL_MEDIA_URL_PATH = '/api/v1/media-local/public/';

export interface MediaSource {
  protocol: 'http' | 'https';
  hostname: string;
  /** '' when the default port is used. */
  port: string;
  /** Path prefix with a trailing slash; only URLs below it are allowed. */
  pathPrefix: string;
}

export interface MediaEnv {
  /** NEXT_PUBLIC_MEDIA_BASE_URL (= the API's R2_PUBLIC_BASE_URL). */
  mediaBaseUrl?: string | undefined;
  /** NEXT_PUBLIC_MEDIA_ORIGINS: further base URLs, comma separated (rarely needed). */
  extraBaseUrls?: string | undefined;
  /** NEXT_PUBLIC_API_BASE_URL: serves local-storage media. */
  apiBaseUrl: string;
}

function sourceFrom(baseUrl: string, relativePrefix: string): MediaSource | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    hostname: url.hostname,
    port: url.port,
    pathPrefix: `${basePath}/${relativePrefix.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/'),
  };
}

/** The allowed media locations for this configuration. */
export function mediaSourcesFrom(env: MediaEnv): MediaSource[] {
  const bases = [env.mediaBaseUrl, ...(env.extraBaseUrls ?? '').split(',')]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const sources = bases.map((base) => sourceFrom(base, MEDIA_KEY_PREFIX));
  // Local storage: only the public media folder of the API, never the rest of its routes.
  sources.push(
    sourceFrom(env.apiBaseUrl, `${LOCAL_MEDIA_URL_PATH}${MEDIA_KEY_PREFIX}`.replace(/^\//, '')),
  );
  return sources.filter((source): source is MediaSource => source !== null);
}

/** true only for http(s) URLs on an allowed host and port, below the media path, without tricks. */
export function isAllowedMediaUrl(value: string, sources: readonly MediaSource[]): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (/(^|\/)\.\.(\/|$)/.test(decodeURIComponent(url.pathname))) return false;
  const protocol = url.protocol === 'https:' ? 'https' : 'http';
  return sources.some(
    (source) =>
      source.protocol === protocol &&
      source.hostname === url.hostname &&
      source.port === url.port &&
      url.pathname.startsWith(source.pathPrefix),
  );
}

/** Origins (for the Content-Security-Policy img-src / media-src lists). */
export function mediaOriginsOf(sources: readonly MediaSource[]): string[] {
  return [
    ...new Set(
      sources.map(
        (source) =>
          `${source.protocol}://${source.hostname}${source.port ? `:${source.port}` : ''}`,
      ),
    ),
  ];
}

/** next.config images.remotePatterns: host AND media path only (never the whole host). */
export function remotePatternsOf(sources: readonly MediaSource[]) {
  return sources.map((source) => ({
    protocol: source.protocol,
    hostname: source.hostname,
    ...(source.port ? { port: source.port } : {}),
    pathname: `${source.pathPrefix}**`,
  }));
}
