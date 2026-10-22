import { describe, expect, it } from 'vitest';
import { listHref, normalizeQuery, parseListState } from './list-params';

describe('parseListState', () => {
  it('uses defaults for a bare URL', () => {
    expect(parseListState({})).toEqual({ page: 1, sort: 'newest', type: undefined });
  });
  it('reads valid values', () => {
    expect(parseListState({ page: '3', sort: 'price_asc', type: 'Shirt' })).toEqual({
      page: 3,
      sort: 'price_asc',
      type: 'shirt',
    });
  });
  it('ignores junk instead of failing', () => {
    expect(parseListState({ page: '-2', sort: 'drop table', type: '../etc' })).toEqual({
      page: 1,
      sort: 'newest',
      type: undefined,
    });
    expect(parseListState({ page: '1.5' }).page).toBe(1);
    expect(parseListState({ page: ['4', '5'] }).page).toBe(4);
  });
});

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and limits the length', () => {
    expect(normalizeQuery('  agbada   set ')).toBe('agbada set');
    expect(normalizeQuery('x'.repeat(300))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe('');
  });
  it('keeps markup as plain text (React escapes it on render)', () => {
    expect(normalizeQuery('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('listHref', () => {
  it('drops defaults', () => {
    expect(listHref('/shop', { page: 1, sort: 'newest' })).toBe('/shop');
  });
  it('keeps what differs and encodes it', () => {
    expect(listHref('/search', { q: 'agbada set', page: 2, sort: 'name', type: 'shirt' })).toBe(
      '/search?q=agbada+set&type=shirt&sort=name&page=2',
    );
  });
});
