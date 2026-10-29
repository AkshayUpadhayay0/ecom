import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAutoplayBlocked } from './play-result';
import { registerPausedVideo, resetPausedNotices, usePausedNotice } from './video-notice';
import { renderHook, act } from '@testing-library/react';

afterEach(() => {
  resetPausedNotices();
});

describe('isAutoplayBlocked', () => {
  it('is true only for NotAllowedError', () => {
    expect(isAutoplayBlocked(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe(
      true,
    );
    expect(isAutoplayBlocked(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
    expect(isAutoplayBlocked(Object.assign(new Error('x'), { name: 'NotSupportedError' }))).toBe(
      false,
    );
    expect(isAutoplayBlocked(new Error('plain'))).toBe(false);
    expect(isAutoplayBlocked(null)).toBe(false);
    expect(isAutoplayBlocked(undefined)).toBe(false);
  });
});

describe('paused-video notice', () => {
  it('shows the most important reason and clears when the last video is withdrawn', () => {
    const { result } = renderHook(() => usePausedNotice());
    expect(result.current).toBeNull();
    let stopBlocked = (): void => undefined;
    let stopReduced = (): void => undefined;
    act(() => {
      stopBlocked = registerPausedVideo('a', { reason: 'autoplay_blocked', detail: null });
    });
    expect(result.current?.reason).toBe('autoplay_blocked');
    act(() => {
      stopReduced = registerPausedVideo('b', { reason: 'reduced_motion', detail: null });
    });
    expect(result.current?.reason).toBe('reduced_motion'); // the visitor's choice wins
    act(() => {
      stopReduced();
    });
    expect(result.current?.reason).toBe('autoplay_blocked');
    act(() => {
      stopBlocked();
    });
    expect(result.current).toBeNull();
  });

  it('keeps the connection type for the slow-connection message', () => {
    const { result } = renderHook(() => usePausedNotice());
    act(() => {
      registerPausedVideo('a', { reason: 'slow', detail: '3g' });
    });
    expect(result.current).toEqual({ reason: 'slow', detail: '3g' });
  });

  it('does not notify for an unchanged notice', () => {
    const listener = vi.fn();
    const { result } = renderHook(() => {
      listener();
      return usePausedNotice();
    });
    act(() => {
      registerPausedVideo('a', { reason: 'save_data', detail: null });
    });
    const calls = listener.mock.calls.length;
    act(() => {
      registerPausedVideo('b', { reason: 'save_data', detail: null });
    });
    expect(listener.mock.calls.length).toBe(calls);
    expect(result.current?.reason).toBe('save_data');
  });
});
