'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { loginHref } from '@/lib/auth/safe-redirect';
import { SIGNED_OUT_EVENT } from '@/lib/client/bff';
import { notifySessionChanged } from '@/lib/client/session';

/**
 * Client data layer. Private data (cart, account) is fetched here through the BFF; public pages
 * stay server-rendered. When the server reports the session is gone, the cache is dropped and the
 * shopper is sent to login with a safe return path.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 15_000, retry: 1 } },
      }),
  );

  useEffect(() => {
    const onSignedOut = (): void => {
      client.clear();
      notifySessionChanged();
      const here = `${window.location.pathname}${window.location.search}`;
      if (/^\/(account|cart)(\/|$)/.test(window.location.pathname)) {
        window.location.assign(loginHref(here));
      }
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
