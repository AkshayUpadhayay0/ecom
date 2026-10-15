import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Env } from '../../config/env.js';

export interface OutgoingEmail {
  /** Stable per outbox row: a retried send reuses it, so providers can de-duplicate. */
  idempotencyKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Implemented by the real provider once the client chooses one [PENDING CLIENT DECISION]. */
export interface EmailSender {
  readonly mocked: boolean;
  send(email: OutgoingEmail): Promise<void>;
}

const SAFE_FILE_NAME = /[^A-Za-z0-9_-]/g;

/**
 * MOCK ("log") email provider: nothing is delivered. Each email is written to the log and to
 * `<dir>/<idempotencyKey>.txt` (a retry overwrites the same file), so developers can read
 * confirmation emails and follow verification / reset links locally. Refused in production.
 */
export function createLogEmailSender(logger: Logger, dir: string): EmailSender {
  return {
    mocked: true,
    async send(email) {
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${email.idempotencyKey.replace(SAFE_FILE_NAME, '_')}.txt`);
      const body = `MOCK EMAIL (not sent)\nFrom: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`;
      await writeFile(file, body, 'utf8');
      logger.info(
        { mockEmail: { to: email.to, subject: email.subject, file } },
        `MOCK EMAIL (not sent)\n----------------------------------------\n${email.text}\n----------------------------------------`,
      );
    },
  };
}

/** The configured provider. Only 'log' (MOCK) exists until the client picks a real one. */
export function createEmailSender(env: Env, logger: Logger): EmailSender {
  // EMAIL_PROVIDER can only be 'log' today; a real provider adds a branch here.
  return createLogEmailSender(logger, env.EMAIL_LOG_DIR);
}
