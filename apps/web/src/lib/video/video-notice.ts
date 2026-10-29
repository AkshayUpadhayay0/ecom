import { useSyncExternalStore } from 'react';

/**
 * Why videos on this page are not playing by themselves. Cards and the hero register a reason while
 * they are paused for it; the small notice shows the most important one, so a tester understands
 * why instead of silently seeing posters.
 */
export type PausedReason = 'reduced_motion' | 'save_data' | 'slow' | 'autoplay_blocked';

export interface PausedNotice {
  reason: PausedReason;
  /** e.g. "3g" for the slow-connection message. */
  detail: string | null;
}

/** Most specific first: what the visitor chose beats what the browser decided. */
const PRIORITY: readonly PausedReason[] = [
  'reduced_motion',
  'save_data',
  'slow',
  'autoplay_blocked',
];

const entries = new Map<string, PausedNotice>();
const listeners = new Set<() => void>();
let current: PausedNotice | null = null;

function recompute(): void {
  let next: PausedNotice | null = null;
  for (const reason of PRIORITY) {
    const found = [...entries.values()].find((entry) => entry.reason === reason);
    if (found) {
      next = found;
      break;
    }
  }
  if (next?.reason === current?.reason && next?.detail === current?.detail) return;
  current = next;
  listeners.forEach((listener) => {
    listener();
  });
}

/** Returns the function that withdraws the registration (call it from an effect cleanup). */
export function registerPausedVideo(id: string, notice: PausedNotice): () => void {
  entries.set(id, notice);
  recompute();
  return () => {
    entries.delete(id);
    recompute();
  };
}

export function usePausedNotice(): PausedNotice | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
}

/** Tests only. */
export function resetPausedNotices(): void {
  entries.clear();
  recompute();
}
