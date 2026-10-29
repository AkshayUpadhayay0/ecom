import type { Logger } from 'pino';

/**
 * Tells the customer website to drop its cached public data, so a video that just became ready (or
 * was replaced, removed or published) shows up at once instead of after the website's own cache
 * time. Server to server only: a POST with a shared secret to the website's /api/revalidate route.
 *
 * It is a best-effort nudge. Failures are logged and never thrown (the website still refreshes by
 * itself within its normal cache time), and calls close together are sent as ONE request.
 */
export interface WebRevalidator {
  /** false when WEB_REVALIDATE_URL / WEB_REVALIDATE_SECRET are not set (every call is a no-op). */
  readonly enabled: boolean;
  /** Ask for a refresh soon. Never throws, never waits for the website. */
  revalidate(reason: string): void;
  /** Sends anything pending now and waits for it (shutdown and tests). */
  flush(): Promise<void>;
}

/** The public data groups the website caches (see apps/web/src/lib/api/public.ts). */
export const REVALIDATE_TAGS = ['catalog', 'site'] as const;

export interface WebRevalidatorOptions {
  url: string | undefined;
  secret: string | undefined;
  logger: Logger;
  /** Calls within this window become one request. */
  debounceMs?: number;
  timeoutMs?: number;
  /** Delay before the 2nd and 3rd attempt. */
  retryDelaysMs?: readonly number[];
  fetchImpl?: typeof fetch;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 2_000] as const;

export function createWebRevalidator(options: WebRevalidatorOptions): WebRevalidator {
  const { url, secret, logger } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const doFetch = options.fetchImpl ?? fetch;

  if (!url || !secret) {
    return { enabled: false, revalidate: () => undefined, flush: () => Promise.resolve() };
  }

  let timer: NodeJS.Timeout | undefined;
  let reasons = new Set<string>();
  let inFlight: Promise<void> = Promise.resolve();

  async function attempt(reason: string): Promise<boolean> {
    try {
      const response = await doFetch(url as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret as string}`,
        },
        body: JSON.stringify({ tags: REVALIDATE_TAGS, reason }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return true;
      logger.warn({ status: response.status }, 'website revalidation was refused');
    } catch (err) {
      logger.warn({ err }, 'website revalidation request failed');
    }
    return false;
  }

  async function send(): Promise<void> {
    timer = undefined;
    const reason = [...reasons].slice(0, 5).join('; ');
    reasons = new Set();
    for (let i = 0; i <= retryDelays.length; i += 1) {
      if (await attempt(reason)) {
        logger.info({ reason }, 'website told to refresh its public data');
        return;
      }
      const delay = retryDelays[i];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    logger.error({ reason }, 'website could not be told to refresh; it will catch up by itself');
  }

  return {
    enabled: true,
    revalidate(reason) {
      reasons.add(reason);
      if (timer) return;
      timer = setTimeout(() => {
        inFlight = inFlight.then(send, send);
      }, debounceMs);
      timer.unref();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        inFlight = inFlight.then(send, send);
      }
      await inFlight;
    },
  };
}
