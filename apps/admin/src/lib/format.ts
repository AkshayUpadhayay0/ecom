const LOCALE = 'en-NG';
const MINOR_UNITS_PER_NAIRA = 100;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const nairaFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
});

/**
 * Formats an amount in kobo (minor units, integer) as Naira for DISPLAY only.
 * Money is never computed in the browser.
 */
export function formatNaira(minor: number): string {
  return nairaFormatter.format(minor / MINOR_UNITS_PER_NAIRA);
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(date);
}

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** "5 minutes ago", "2 hours ago", "yesterday". */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(seconds) < SECONDS_PER_MINUTE) return relativeFormatter.format(seconds, 'second');
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return relativeFormatter.format(minutes, 'minute');
  if (Math.abs(hours) < HOURS_PER_DAY) return relativeFormatter.format(hours, 'hour');
  return relativeFormatter.format(Math.round(hours / HOURS_PER_DAY), 'day');
}

/** Greeting by local time of day. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
