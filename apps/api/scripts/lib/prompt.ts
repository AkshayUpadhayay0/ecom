/** Terminal prompts for the admin CLIs. Hidden input is never echoed, logged or stored. */
import { createInterface } from 'node:readline';
import { createInterface as createInterfaceAsync } from 'node:readline/promises';

const CTRL_C = '\u0003';
const BACKSPACE_CODES = new Set(['\u0008', '\u007f']);
const ENTER_CODES = new Set(['\r', '\n']);

let pipedLines: AsyncIterator<string> | undefined;

/**
 * Piped (non-terminal) input: ONE reader for the whole run, one line per question. A reader per
 * question would swallow every buffered line on the first question.
 */
async function readPipedLine(question: string): Promise<string> {
  process.stdout.write(question);
  pipedLines ??= createInterface({ input: process.stdin, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const next = await pipedLines.next();
  process.stdout.write('\n');
  if (next.done === true) throw new Error('Input ended before every question was answered.');
  return next.value;
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return (await readPipedLine(question)).trim();
  const rl = createInterfaceAsync({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a line without echoing it. Falls back to a plain read when stdin is not a terminal. */
export function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return readPipedLine(question);
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === CTRL_C) {
          finish(new Error('Cancelled.'));
          return;
        }
        if (ENTER_CODES.has(char)) {
          finish();
          return;
        }
        if (BACKSPACE_CODES.has(char)) {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}
