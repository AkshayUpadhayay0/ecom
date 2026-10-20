import { zonedDateStart, zonedDaysBefore } from '@urban-ibile/shared';

/**
 * Admin list date filters. A date-only value ("2026-10-20") is a whole day in the store time zone
 * (setting `store.timezone`, default Africa/Lagos); a full ISO datetime is used as given. `to` is
 * inclusive, so it becomes an exclusive upper bound.
 */
export function storeDateRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { from: Date | undefined; toExclusive: Date | undefined } {
  return {
    from: from === undefined ? undefined : (zonedDateStart(from, timeZone) ?? new Date(from)),
    toExclusive: to === undefined ? undefined : exclusiveEnd(to, timeZone),
  };
}

function exclusiveEnd(value: string, timeZone: string): Date {
  const dayStart = zonedDateStart(value, timeZone);
  // Next local midnight (correct on 23/25-hour days); a datetime is inclusive to the millisecond.
  return dayStart
    ? zonedDaysBefore(dayStart, -1, timeZone)
    : new Date(new Date(value).getTime() + 1);
}
