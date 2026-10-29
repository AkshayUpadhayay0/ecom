import pg from 'pg';
import type { Logger } from 'pino';

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export interface JobWakeup {
  close(): Promise<void>;
}

/**
 * Calls `onJob` the moment another process runs `pg_notify(channel, ...)` (Postgres LISTEN/NOTIFY),
 * so the worker starts a new job at once instead of waiting for its next poll. Uses its own
 * connection and reconnects with a growing delay if it drops; the worker's regular poll stays as
 * the safety net, so a lost notification only costs one poll interval.
 */
export function listenForJobs(
  connectionString: string,
  channel: string,
  onJob: () => void,
  logger: Logger,
): JobWakeup {
  let closed = false;
  let client: pg.Client | undefined;
  let retryMs = FIRST_RETRY_MS;
  let retryTimer: NodeJS.Timeout | undefined;

  function scheduleReconnect(): void {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }

  async function connect(): Promise<void> {
    if (closed) return;
    const next = new pg.Client({ connectionString, application_name: 'urban-ibile-worker-listen' });
    client = next;
    next.on('notification', (message) => {
      if (message.channel === channel) onJob();
    });
    next.on('error', (err) => {
      logger.warn({ err }, 'job wake-up connection lost; the poll still runs');
      next.removeAllListeners();
      void next.end().catch(() => undefined);
      scheduleReconnect();
    });
    try {
      await next.connect();
      // Identifier is a constant from this codebase, never user input.
      await next.query(`LISTEN ${channel}`);
      retryMs = FIRST_RETRY_MS;
      onJob(); // a job may have been queued while we were not listening
    } catch (err) {
      logger.warn({ err }, 'could not listen for new jobs; the poll still runs');
      next.removeAllListeners();
      void next.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect();

  return {
    async close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      const current = client;
      client = undefined;
      current?.removeAllListeners();
      await current?.end().catch(() => undefined);
    },
  };
}
