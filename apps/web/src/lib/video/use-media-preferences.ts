'use client';

import { useSyncExternalStore } from 'react';
import { SLOW_CONNECTION_TYPES } from '@/config/constants';

export interface MediaPreferences {
  /** prefers-reduced-motion: no autoplay. */
  reducedMotion: boolean;
  /** Data-saver on, or a slow connection: posters only, tap to play. */
  saveData: boolean;
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function connection(): NetworkInformation | undefined {
  // navigator.connection is not in the DOM typings (Chromium only).
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

export function isConstrainedConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const net = connection();
  if (!net) return false;
  return (
    net.saveData === true ||
    (net.effectiveType !== undefined &&
      (SLOW_CONNECTION_TYPES as readonly string[]).includes(net.effectiveType))
  );
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const net = connection();
  query.addEventListener('change', onChange);
  net?.addEventListener?.('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
    net?.removeEventListener?.('change', onChange);
  };
}

// useSyncExternalStore needs a stable snapshot value: encode both flags in one string.
function snapshot(): string {
  const reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  return `${reduced ? 1 : 0}${isConstrainedConnection() ? 1 : 0}`;
}

/** Server and first client render assume "no preference" (posters render either way). */
function serverSnapshot(): string {
  return '00';
}

export function useMediaPreferences(): MediaPreferences {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { reducedMotion: value[0] === '1', saveData: value[1] === '1' };
}
