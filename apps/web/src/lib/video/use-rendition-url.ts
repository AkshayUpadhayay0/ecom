'use client';

import type { PublicVideoSourceDto } from '@urban-ibile/shared';
import { useCallback, useSyncExternalStore } from 'react';
import { pickRendition } from './renditions';
import { isConstrainedConnection } from './use-media-preferences';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/**
 * URL of the MP4 rendition that suits this viewport and connection. null on the server and on the
 * first client render (so hydration matches), then the chosen file.
 */
export function useRenditionUrl(sources: readonly PublicVideoSourceDto[]): string | null {
  const snapshot = useCallback(
    () =>
      pickRendition(sources, {
        viewportWidth: window.innerWidth,
        constrained: isConstrainedConnection(),
      })?.url ?? null,
    [sources],
  );
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
