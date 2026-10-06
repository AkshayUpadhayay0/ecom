import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import type { EmailOutboxRepository } from './email-outbox.repository.js';
import type { EmailSender } from './email-sender.js';
import { SENSITIVE_TEMPLATES, renderEmail } from './email-templates.js';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 60_000;

export interface EmailOutboxServiceDeps {
  db: Database;
  repository: EmailOutboxRepository;
  sender: EmailSender;
  from: string;
  logger: Logger;
}

export interface EmailOutboxService {
  /** Sends one batch of due emails. Returns how many rows were processed. */
  processBatch(): Promise<number>;
  /**
   * TEMP: in-process polling loop. Replaced by a BullMQ worker when Redis is introduced
   * (Phase 6). Returns a stop function.
   */
  startPolling(intervalMs: number): () => void;
}

export function createEmailOutboxService(deps: EmailOutboxServiceDeps): EmailOutboxService {
  const { db, repository, sender, logger } = deps;

  async function processBatch(): Promise<number> {
    return db.transaction().execute(async (trx) => {
      const due = await repository.claimDue(trx, BATCH_SIZE);
      for (const email of due) {
        try {
          const rendered = renderEmail(email.template, email.payload);
          await sender.send({ from: deps.from, to: email.recipient, ...rendered });
          await repository.markSent(trx, email.id, SENSITIVE_TEMPLATES.has(email.template));
        } catch (err) {
          const attempts = email.attempts + 1;
          const giveUp = attempts >= MAX_ATTEMPTS;
          const nextAttemptAt = new Date(Date.now() + RETRY_BASE_MS * attempts ** 2);
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ emailId: email.id, attempts, giveUp, err }, 'email send failed');
          await repository.markFailed(trx, email.id, message, nextAttemptAt, giveUp);
        }
      }
      return due.length;
    });
  }

  return {
    processBatch,
    startPolling(intervalMs) {
      let running = false;
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        processBatch()
          .catch((err: unknown) => {
            logger.error({ err }, 'email outbox poll failed');
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
      timer.unref();
      return () => {
        clearInterval(timer);
      };
    },
  };
}
