import { describe, expect, it } from 'vitest';
import { pageWindow } from './pagination';

describe('pageWindow', () => {
  it('shows every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
  it('keeps first and last with gaps around the current page', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
  });
  it('does not add a gap when pages are adjacent', () => {
    expect(pageWindow(3, 8)).toEqual([1, 2, 3, 4, 5, 'gap', 8]);
  });
});
