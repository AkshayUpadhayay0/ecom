'use client';

import { useEffect, useState } from 'react';

const MAX_TOKEN_LENGTH = 512;
/** Survives a second effect run (React strict mode) after the token left the address bar. */
const captured = new Map<string, string>();

/**
 * One-time links carry their secret in the query string (?token=...). Read it once, then remove
 * it from the address bar (and history entry) so it cannot leak through screenshots, history
 * sync or the Referer header. The token only ever travels in a POST body to our own BFF.
 */
export function useUrlToken(): { token: string | null; ready: boolean } {
  const [state, setState] = useState<{ token: string | null; ready: boolean }>({
    token: null,
    ready: false,
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('token');
    if (fromUrl) {
      captured.set(url.pathname, fromUrl);
      url.searchParams.delete('token');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    const token = captured.get(url.pathname) ?? null;
    // Reading the browser URL once after mount (an external system): the state cannot be derived earlier.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ token: token && token.length <= MAX_TOKEN_LENGTH ? token : null, ready: true });
  }, []);
  return state;
}
