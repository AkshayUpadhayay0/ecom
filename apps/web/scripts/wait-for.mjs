// Waits until a file exists (used by the e2e config so the second web build starts only after the
// first one finished and the shared package is built: both would otherwise rebuild it at once).
import { access } from 'node:fs/promises';

const [file, timeoutSeconds = '300'] = process.argv.slice(2);
if (!file) throw new Error('usage: node wait-for.mjs <file> [timeoutSeconds]');
const deadline = Date.now() + Number(timeoutSeconds) * 1000;

for (;;) {
  try {
    await access(file);
    break;
  } catch {
    if (Date.now() > deadline) {
      console.error(`Timed out waiting for ${file}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
