/*
 * Store time zone helpers (Intl only, no dependencies). Timestamps are stored in UTC; the store
 * time zone (setting `store.timezone`, default Africa/Lagos) decides what "today", a date-only
 * filter and every displayed date/time mean. [Technical Recommendation, 20 Oct 2026: the client
 * is Nigeria-based.]
 */

export const DEFAULT_STORE_TIME_ZONE = 'Africa/Lagos';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** Midday is safely inside the same local date on both sides of any DST change. */
const MIDDAY_MS = 12 * MS_PER_HOUR;

/** True for a time zone name the runtime knows (e.g. "Africa/Lagos"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    partFormatter(timeZone)
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `date`, in ms (Africa/Lagos: +3 600 000). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on the given local calendar date. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Re-check with the offset at the candidate itself (correct across DST changes).
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** Start (local midnight, as a UTC instant) of the store day that contains `date`. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return localMidnight(p.year, p.month, p.day, timeZone);
}

/** Start of the local day `days` calendar days before the day that starts at `dayStart`. */
export function zonedDaysBefore(dayStart: Date, days: number, timeZone: string): Date {
  return startOfZonedDay(new Date(dayStart.getTime() + MIDDAY_MS - days * MS_PER_DAY), timeZone);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-20" -> the UTC instant of local midnight that day in `timeZone`; null if not a date. */
export function zonedDateStart(value: string, timeZone: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  return localMidnight(Number(match[1]), Number(match[2]), Number(match[3]), timeZone);
}
