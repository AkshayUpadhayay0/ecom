'use client';

import { useSyncExternalStore } from 'react';
import { SLOW_CONNECTION_TYPES } from '@/config/constants';

/** Why a connection counts as constrained: the visitor's Data Saver, or a slow link (2g, 3g). */
export type ConstrainedKind = 'save_data' | 'slow';

export interface MediaPreferences {
  /** prefers-reduced-motion: no autoplay. */
  reducedMotion: boolean;
  /** Data-saver on, or a slow connection: posters only, tap to play. */
  saveData: boolean;
  /** Which of the two made `saveData` true (null when it is false). */
  constrainedKind: ConstrainedKind | null;
  /** navigator.connection.effectiveType (e.g. "3g"), for the label. */
  connectionType: string | null;
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

/** null when the connection is fine (or unknown: Safari and Firefox do not report it). */
export function constrainedKind(): ConstrainedKind | null {
  if (typeof navigator === 'undefined') return null;
  const net = connection();
  if (!net) return null;
  if (net.saveData === true) return 'save_data';
  if (
    net.effectiveType !== undefined &&
    (SLOW_CONNECTION_TYPES as readonly string[]).includes(net.effectiveType)
  ) {
    return 'slow';
  }
  return null;
}

export function isConstrainedConnection(): boolean {
  return constrainedKind() !== null;
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

// useSyncExternalStore needs a stable snapshot value: encode the flags in one string
// ("<reduced 0|1><kind 0|s|w>:<effectiveType>").
const KIND_CODE: Record<ConstrainedKind, string> = { save_data: 's', slow: 'w' };
function snapshot(): string {
  const reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
  const kind = constrainedKind();
  return `${reduced ? 1 : 0}${kind ? KIND_CODE[kind] : 0}:${connection()?.effectiveType ?? ''}`;
}

/** Server and first client render assume "no preference" (posters render either way). */
function serverSnapshot(): string {
  return '00:';
}

export function useMediaPreferences(): MediaPreferences {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const kind: ConstrainedKind | null =
    value[1] === 's' ? 'save_data' : value[1] === 'w' ? 'slow' : null;
  return {
    reducedMotion: value[0] === '1',
    saveData: kind !== null,
    constrainedKind: kind,
    connectionType: value.slice(3) || null,
  };
}
