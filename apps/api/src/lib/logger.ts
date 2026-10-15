import { pino, type DestinationStream, type Logger } from 'pino';
import type { Env } from '../config/env.js';

/** Fields that must never reach the logs (passwords, tokens, secrets). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secretAccessKey',
  '*.R2_SECRET_ACCESS_KEY',
  // Hidden-page serial numbers are access secrets.
  '*.serial',
  'req.body',
];

/**
 * The process logger. `destination` (tests) writes plain JSON lines to the given stream instead
 * of stdout / pino-pretty, with the same redaction rules.
 */
export function createLogger(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  if (destination) return pino(options, destination);
  const pretty = env.NODE_ENV === 'development';
  return pino({
    ...options,
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
      },
    }),
  });
}
