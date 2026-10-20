import { DEFAULT_STORE_TIME_ZONE, isValidTimeZone, zonedParts } from '@urban-ibile/shared';

const LOCALE = 'en-NG';
const MINOR_UNITS_PER_NAIRA = 100;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
/** Greeting boundaries (store time zone): morning before 12:00, afternoon until 16:59. */
const NOON_HOUR = 12;
const EVENING_HOUR = 17;

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

/*
 * Dates and times are shown in the STORE time zone (setting `store.timezone`, default
 * Africa/Lagos), never the browser's own zone, so every admin sees the same business day.
 * StoreTimeZoneSync (layout) loads the setting and calls setStoreTimeZone.
 */
let storeTimeZone = DEFAULT_STORE_TIME_ZONE;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function setStoreTimeZone(timeZone: string): void {
  if (isValidTimeZone(timeZone)) storeTimeZone = timeZone;
}

export function getStoreTimeZone(): string {
  return storeTimeZone;
}

type DateStyle = 'long-date' | 'date-time' | 'clock';

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  'long-date': { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  'date-time': { dateStyle: 'medium', timeStyle: 'short' },
  clock: { hour: '2-digit', minute: '2-digit' },
};

function formatter(style: DateStyle): Intl.DateTimeFormat {
  const key = `${storeTimeZone}|${style}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(LOCALE, { ...STYLES[style], timeZone: storeTimeZone });
    formatters.set(key, cached);
  }
  return cached;
}

export function formatLongDate(date: Date): string {
  return formatter('long-date').format(date);
}

export function formatDateTime(date: Date): string {
  return formatter('date-time').format(date);
}

export function formatClockTime(date: Date): string {
  return formatter('clock').format(date);
}

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/** "5 minutes ago", "2 hours ago", "yesterday" (a duration: independent of time zone). */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(seconds) < SECONDS_PER_MINUTE) return relativeFormatter.format(seconds, 'second');
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return relativeFormatter.format(minutes, 'minute');
  if (Math.abs(hours) < HOURS_PER_DAY) return relativeFormatter.format(hours, 'hour');
  return relativeFormatter.format(Math.round(hours / HOURS_PER_DAY), 'day');
}

/**
 * Greeting by the time of day in the store time zone: Good morning before 12:00, Good afternoon
 * 12:00-16:59, Good evening from 17:00.
 */
export function greetingFor(date: Date): string {
  const { hour } = zonedParts(date, storeTimeZone);
  if (hour < NOON_HOUR) return 'Good morning';
  if (hour < EVENING_HOUR) return 'Good afternoon';
  return 'Good evening';
}
