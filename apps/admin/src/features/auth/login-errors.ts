import { ApiError } from '@/lib/api/client';
import { formatClockTime } from '@/lib/format';

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

export interface LoginErrorMessage {
  title: string;
  description: string;
  /** Shown so support can find the request in the API logs. */
  reference?: string;
}

function retryAfterSeconds(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function lockedMessage(details: unknown, now: Date): string {
  const seconds = retryAfterSeconds(details);
  if (seconds === undefined) return 'Too many failed attempts. Try again later.';
  const until = formatClockTime(new Date(now.getTime() + seconds * MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) {
    return `Too many failed attempts. Try again in less than a minute (around ${until}).`;
  }
  const minutes = Math.ceil(seconds / SECONDS_PER_MINUTE);
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Too many failed attempts. Try again in about ${minutes} ${unit} (around ${until}).`;
}

/**
 * Maps API errors to safe, human messages. Never echoes raw server text for credentials, so
 * the message cannot reveal whether an account exists.
 */
export function loginErrorMessage(error: unknown, now: Date = new Date()): LoginErrorMessage {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      description: 'Please try again in a moment.',
    };
  }
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return {
        title: 'Incorrect email or password',
        description: 'Check your details and try again.',
      };
    case 'ACCOUNT_LOCKED':
      return {
        title: 'Account temporarily locked',
        description: lockedMessage(error.details, now),
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many sign-in attempts',
        description: 'Please wait a few minutes before trying again.',
      };
    case 'VALIDATION_ERROR':
      return {
        title: 'Check your details',
        description: 'Enter a valid email address and your password.',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'Cannot reach the server',
        description: 'Check your internet connection and try again.',
      };
    default:
      return {
        title: 'Something went wrong on our side',
        description: 'Please try again in a moment.',
        reference: error.requestId,
      };
  }
}
