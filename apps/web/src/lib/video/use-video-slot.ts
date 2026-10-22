'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import {
  MAX_CONCURRENT_VIDEOS,
  VIDEO_ROOT_MARGIN,
  VIDEO_VISIBLE_THRESHOLD,
} from '@/config/constants';
import { VideoSlotPool } from './slot-pool';

/** One pool for the whole page: this is what caps simultaneous playback. */
export const videoPool = new VideoSlotPool(MAX_CONCURRENT_VIDEOS);

function distanceFromViewportCentre(element: Element): number {
  const rect = element.getBoundingClientRect();
  const centre = rect.top + rect.height / 2;
  return Math.abs(centre - window.innerHeight / 2);
}

const scrollWatchers = new Map<VideoSlotPool, { users: number; stop: () => void }>();

function refreshOnScroll(pool: VideoSlotPool): () => void {
  let watcher = scrollWatchers.get(pool);
  if (!watcher) {
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pool.refresh();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    watcher = {
      users: 0,
      stop: () => {
        window.removeEventListener('scroll', onScroll);
        if (frame) cancelAnimationFrame(frame);
        scrollWatchers.delete(pool);
      },
    };
    scrollWatchers.set(pool, watcher);
  }
  watcher.users += 1;
  const current = watcher;
  return () => {
    current.users -= 1;
    if (current.users === 0) current.stop();
  };
}

interface Options {
  /** False for reduced-motion / data-saver / no video: the card never asks for a slot. */
  enabled: boolean;
  pool?: VideoSlotPool;
}

/**
 * True while this element may play its video: it is near the viewport (IntersectionObserver with
 * a small root margin), allowed to play, and holds one of the page's N play slots. Leaving the
 * viewport (or losing the slot to a card nearer the centre) turns it false, so the caller can
 * pause and unload the video.
 */
export function useVideoSlot(ref: RefObject<Element | null>, options: Options): boolean {
  const { enabled, pool = videoPool } = options;
  const id = useId();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const claimant = {
      id,
      distance: () => distanceFromViewportCentre(element),
      grant: () => setActive(true),
      revoke: () => setActive(false),
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry?.isIntersecting) pool.request(claimant);
        else pool.release(id);
      },
      { rootMargin: VIDEO_ROOT_MARGIN, threshold: VIDEO_VISIBLE_THRESHOLD },
    );
    observer.observe(element);
    // One shared, frame-throttled re-rank per pool instead of one listener per card.
    const stopRefreshing = refreshOnScroll(pool);

    return () => {
      stopRefreshing();
      observer.disconnect();
      pool.release(id);
      setActive(false);
    };
  }, [enabled, id, pool, ref]);

  return enabled && active;
}
