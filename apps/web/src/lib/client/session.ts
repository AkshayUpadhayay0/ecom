'use client';

import type { CustomerDto } from '@urban-ibile/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { COOKIE_NAMES } from '@/lib/auth/cookies';
import { bff, BffError } from './bff';

const SESSION_CHANGED_EVENT = 'ui:session-changed';

function hasHintCookie(): boolean {
  return document.cookie.split('; ').some((part) => part === `${COOKIE_NAMES.hint}=1`);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SESSION_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener(SESSION_CHANGED_EVENT, onChange);
  };
}

/** Tells every useHasSession() that the cookies just changed (login, logout, expiry). */
export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

/**
 * Whether a session cookie hint exists. This is a UI hint only (which links to show, whether to
 * fetch the cart): the API decides every real request. false on the server and first render.
 */
export function useHasSession(): boolean {
  return useSyncExternalStore(subscribe, hasHintCookie, () => false);
}

export const ME_KEY = ['me'] as const;

/** The signed-in customer (null when signed out). */
export function useMe() {
  const hasSession = useHasSession();
  return useQuery({
    queryKey: ME_KEY,
    enabled: hasSession,
    staleTime: 60_000,
    queryFn: () => bff<CustomerDto>('auth/me'),
    retry: (count, error) => !(error instanceof BffError && error.status < 500) && count < 2,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    try {
      await bff<undefined>('auth/logout', { method: 'POST' });
    } finally {
      queryClient.clear();
      notifySessionChanged();
    }
  }, [queryClient]);
}
