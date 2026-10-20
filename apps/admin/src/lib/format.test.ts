import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatLongDate,
  getStoreTimeZone,
  greetingFor,
  setStoreTimeZone,
} from './format';

/** Store time zone tests (Africa/Lagos = UTC+1, no daylight saving). */
afterEach(() => {
  setStoreTimeZone('Africa/Lagos');
});

describe('store time zone formatting', () => {
  it('defaults to Africa/Lagos and ignores invalid zone names', () => {
    expect(getStoreTimeZone()).toBe('Africa/Lagos');
    setStoreTimeZone('Not/AZone');
    expect(getStoreTimeZone()).toBe('Africa/Lagos');
  });

  it.each([
    ['2026-10-20T05:00:00Z', 'Good morning'], // 06:00 Lagos
    ['2026-10-20T10:59:00Z', 'Good morning'], // 11:59 Lagos
    ['2026-10-20T11:00:00Z', 'Good afternoon'], // 12:00 Lagos
    ['2026-10-20T15:59:00Z', 'Good afternoon'], // 16:59 Lagos
    ['2026-10-20T16:00:00Z', 'Good evening'], // 17:00 Lagos
    ['2026-10-20T22:59:00Z', 'Good evening'], // 23:59 Lagos
    ['2026-10-20T23:30:00Z', 'Good morning'], // 00:30 Lagos, next day
  ])('greets by the Lagos time of day at %s UTC', (utc, greeting) => {
    expect(greetingFor(new Date(utc))).toBe(greeting);
  });

  it('shows dates near midnight in Lagos, not the browser zone', () => {
    // 23:30 UTC on 19 Oct is already 00:30 on Tuesday 20 Oct in Lagos.
    const lateUtc = new Date('2026-10-19T23:30:00Z');
    expect(formatLongDate(lateUtc)).toMatch(/Tuesday.*20 October 2026/);
    expect(formatDateTime(lateUtc)).toMatch(/20 Oct 2026/);
    expect(formatDateTime(lateUtc)).toMatch(/00:30|12:30/);
    // 22:30 UTC is still Monday 19 Oct (23:30) in Lagos.
    expect(formatLongDate(new Date('2026-10-19T22:30:00Z'))).toMatch(/Monday.*19 October 2026/);
  });

  it('follows the configured store time zone', () => {
    setStoreTimeZone('America/New_York');
    // 23:30 UTC on 19 Oct is 19:30 on 19 Oct in New York (EDT).
    expect(formatLongDate(new Date('2026-10-19T23:30:00Z'))).toMatch(/Monday.*19 October 2026/);
    expect(greetingFor(new Date('2026-10-19T23:30:00Z'))).toBe('Good evening');
  });
});
