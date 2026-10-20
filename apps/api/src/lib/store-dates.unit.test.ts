import {
  DEFAULT_STORE_TIME_ZONE,
  isValidTimeZone,
  startOfZonedDay,
  zonedDateStart,
  zonedDaysBefore,
  zonedParts,
} from '@urban-ibile/shared';
import { describe, expect, it } from 'vitest';
import { storeDateRange } from './store-dates.js';

const LAGOS = DEFAULT_STORE_TIME_ZONE;

describe('store time zone helpers (shared)', () => {
  it('defaults to Africa/Lagos and validates IANA names', () => {
    expect(LAGOS).toBe('Africa/Lagos');
    expect(isValidTimeZone('Africa/Lagos')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('reads wall-clock parts in the store zone', () => {
    expect(zonedParts(new Date('2026-10-19T23:30:00Z'), LAGOS)).toMatchObject({
      year: 2026,
      month: 10,
      day: 20,
      hour: 0,
      minute: 30,
    });
  });

  it('starts the Lagos day at 23:00 UTC the evening before', () => {
    // 00:30 Lagos on 20 Oct -> day started 19 Oct 23:00 UTC.
    expect(startOfZonedDay(new Date('2026-10-19T23:30:00Z'), LAGOS).toISOString()).toBe(
      '2026-10-19T23:00:00.000Z',
    );
    // 22:59 UTC on 19 Oct is still 19 Oct in Lagos.
    expect(startOfZonedDay(new Date('2026-10-19T22:59:00Z'), LAGOS).toISOString()).toBe(
      '2026-10-18T23:00:00.000Z',
    );
  });

  it('steps whole calendar days, also across a daylight-saving change', () => {
    const today = startOfZonedDay(new Date('2026-10-20T10:00:00Z'), LAGOS);
    expect(zonedDaysBefore(today, 6, LAGOS).toISOString()).toBe('2026-10-13T23:00:00.000Z');
    // London leaves summer time on 25 Oct 2026: the 26th starts at 00:00 UTC, the 25th at 23:00
    // UTC on the 24th.
    const london = startOfZonedDay(new Date('2026-10-26T12:00:00Z'), 'Europe/London');
    expect(london.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(zonedDaysBefore(london, 1, 'Europe/London').toISOString()).toBe(
      '2026-10-24T23:00:00.000Z',
    );
  });

  it('turns a date-only value into local midnight', () => {
    expect(zonedDateStart('2026-10-20', LAGOS)?.toISOString()).toBe('2026-10-19T23:00:00.000Z');
    expect(zonedDateStart('2026-10-20T10:00:00Z', LAGOS)).toBeNull();
  });
});

describe('storeDateRange (admin list filters)', () => {
  it('covers whole Lagos days, `to` inclusive', () => {
    expect(storeDateRange('2026-10-20', '2026-10-20', LAGOS)).toEqual({
      from: new Date('2026-10-19T23:00:00.000Z'),
      toExclusive: new Date('2026-10-20T23:00:00.000Z'),
    });
  });

  it('uses full datetimes as given (inclusive to the millisecond)', () => {
    expect(storeDateRange('2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', LAGOS)).toEqual({
      from: new Date('2026-10-20T08:00:00.000Z'),
      toExclusive: new Date('2026-10-20T09:00:00.001Z'),
    });
    expect(storeDateRange(undefined, undefined, LAGOS)).toEqual({
      from: undefined,
      toExclusive: undefined,
    });
  });
});
