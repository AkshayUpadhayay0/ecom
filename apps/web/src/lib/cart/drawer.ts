'use client';

import { useSyncExternalStore } from 'react';

/** Open/closed state of the mini-cart drawer, shared by the header button and "add to cart". */
let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setCartDrawerOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCartDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
