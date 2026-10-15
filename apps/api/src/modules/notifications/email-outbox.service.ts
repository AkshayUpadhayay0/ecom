import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { EmailOutboxRepository } from './email-outbox.repository.js';
import type { EmailSender } from './email-sender.js';
import { SENSITIVE_TEMPLATES, renderEmail } from './email-templates.js';

const MS_PER_SECOND = 1000;

export interface EmailOutboxServiceDeps {
  db: Database;
  repository: EmailOutboxRepository;
  sender: EmailSender;
  settings: SettingsService;
  from: string;
  batchSize: number;
  logger: Logger;
}

export interface EmailOutboxService {
  /**
   * Sends one batch of due emails (run by `pnpm worker`). Rows are claimed with FOR UPDATE SKIP
   * LOCKED, so parallel workers never send the same row; a failure is retried with backoff
   * (email.retry_base_seconds * attempts^2) up to email.max_attempts, then marked failed.
   * Returns how many rows were processed.
   */
  processBatch(): Promise<number>;
}

export function createEmailOutboxService(deps: EmailOutboxServiceDeps): EmailOutboxService {
  const { db, repository, sender, settings, logger } = deps;

  return {
    async processBatch() {
      const [maxAttempts, retryBaseSeconds] = await Promise.all([
        settings.getLimit(db, 'email.max_attempts'),
        settings.getLimit(db, 'email.retry_base_seconds'),
      ]);
      return db.transaction().execute(async (trx) => {
        const due = await repository.claimDue(trx, deps.batchSize);
        for (const email of due) {
          try {
            const rendered = renderEmail(email.template, email.payload, email.languageCode);
            await sender.send({
              idempotencyKey: email.id,
              from: deps.from,
              to: email.recipient,
              ...rendered,
            });
            await repository.markSent(trx, email.id, SENSITIVE_TEMPLATES.has(email.template));
          } catch (err) {
            const attempts = email.attempts + 1;
            const giveUp = attempts >= maxAttempts;
            const nextAttemptAt = new Date(
              Date.now() + retryBaseSeconds * MS_PER_SECOND * attempts ** 2,
            );
            const message = err instanceof Error ? err.message : String(err);
            // No recipient address or body in the log.
            logger.error(
              { emailId: email.id, template: email.template, attempts, giveUp, err: message },
              'email send failed',
            );
            await repository.markFailed(trx, email.id, message, nextAttemptAt, giveUp);
          }
        }
        return due.length;
      });
    },
  };
}
