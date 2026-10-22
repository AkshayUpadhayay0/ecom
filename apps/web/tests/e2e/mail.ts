import { randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder the e2e API worker writes the MOCK emails into (see playwright.config.ts). */
const MAIL_DIR = fileURLToPath(new URL('../../e2e-mail/', import.meta.url));
const POLL_MS = 300;
const DEFAULT_TIMEOUT_MS = 20_000;

/** A fresh customer address. The e2e-seed clean-up removes every "e2e-*@example.test" customer. */
export function newTestEmail(label = 'user'): string {
  return `e2e-${label}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
}

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

async function readMails(): Promise<Mail[]> {
  let files: string[];
  try {
    files = await readdir(MAIL_DIR);
  } catch {
    return [];
  }
  const withTime = await Promise.all(
    files
      .filter((file) => file.endsWith('.txt'))
      .map(async (file) => ({ file, time: (await stat(join(MAIL_DIR, file))).mtimeMs })),
  );
  const mails: Mail[] = [];
  for (const { file } of withTime.sort((a, b) => b.time - a.time)) {
    const raw = await readFile(join(MAIL_DIR, file), 'utf8');
    const to = /^To: (.+)$/m.exec(raw)?.[1]?.trim();
    const subject = /^Subject: (.+)$/m.exec(raw)?.[1]?.trim();
    if (to && subject) mails.push({ to, subject, text: raw.slice(raw.indexOf('\n\n') + 2) });
  }
  return mails;
}

/** Waits for the newest mock email to `to` whose subject matches, and returns its first link. */
export async function waitForLink(
  to: string,
  subject: RegExp,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = (await readMails()).find((m) => m.to === to && subject.test(m.subject));
    const link = mail ? /https?:\/\/\S+/.exec(mail.text)?.[0] : undefined;
    if (link) return link;
    if (Date.now() > deadline) throw new Error(`No email to ${to} matching ${subject.source}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
