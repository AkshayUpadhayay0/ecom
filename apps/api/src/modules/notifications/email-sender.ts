import type { Logger } from 'pino';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** Implemented by the real provider once the client chooses one [PENDING]. */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * MOCK email sender: nothing is delivered. The full email (including one-time links) is written
 * to the log so developers can follow verification / reset links locally.
 * Replace with a real provider before launch.
 */
export function createMockEmailSender(logger: Logger): EmailSender {
  return {
    send(email) {
      logger.info(
        { mockEmail: { from: email.from, to: email.to, subject: email.subject } },
        `MOCK EMAIL (not sent)\n----------------------------------------\n${email.text}\n----------------------------------------`,
      );
      return Promise.resolve();
    },
  };
}
