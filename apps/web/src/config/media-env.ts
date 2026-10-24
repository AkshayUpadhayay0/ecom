import { isAllowedMediaUrl, mediaSourcesFrom, type MediaSource } from './media';

const API_DEFAULT = 'http://localhost:4000';

let cached: MediaSource[] | undefined;

/**
 * Allowed media locations from the environment. The NEXT_PUBLIC_* variables are written out
 * literally so Next inlines them into the browser bundle too (the check also runs while
 * rendering in the browser).
 */
export function mediaSources(): MediaSource[] {
  cached ??= mediaSourcesFrom({
    mediaBaseUrl: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
    extraBaseUrls: process.env.NEXT_PUBLIC_MEDIA_ORIGINS,
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? API_DEFAULT,
  });
  return cached;
}

export function isMediaUrlAllowed(url: string): boolean {
  return isAllowedMediaUrl(url, mediaSources());
}

/** Tests only: re-read the environment. */
export function resetMediaSourcesCache(): void {
  cached = undefined;
}
