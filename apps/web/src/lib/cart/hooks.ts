'use client';

import type { CartDto } from '@urban-ibile/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bff, BffError } from '@/lib/client/bff';
import { useHasSession } from '@/lib/client/session';
import { withQuantity, withoutLine } from './model';

export const CART_KEY = ['cart'] as const;

/** The server cart (shared with the mobile app). Fetched only while signed in. */
export function useCart() {
  const hasSession = useHasSession();
  return useQuery({
    queryKey: CART_KEY,
    enabled: hasSession,
    queryFn: () => bff<CartDto>('cart'),
    retry: (count, error) => !(error instanceof BffError && error.status < 500) && count < 2,
  });
}

export interface AddItemInput {
  productId: string;
  quantity: number;
  /** Products without a measurement profile. */
  sizeId?: string;
  /** Products with a measurement profile: the Find My Size decision decides the size. */
  blueprintDecisionId?: string;
}

/** Runs one optimistic cart change: snapshot, apply, roll back on error, then re-sync. */
function useOptimisticCart<Input>(
  call: (input: Input) => Promise<CartDto>,
  guess?: (cart: CartDto, input: Input) => CartDto,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onMutate: async (input: Input) => {
      await queryClient.cancelQueries({ queryKey: CART_KEY });
      const previous = queryClient.getQueryData<CartDto>(CART_KEY);
      if (previous && guess) queryClient.setQueryData(CART_KEY, guess(previous, input));
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(CART_KEY, context.previous);
      // Someone (another tab, the app) may have changed the cart: show the truth.
      void queryClient.invalidateQueries({ queryKey: CART_KEY });
    },
    onSuccess: (cart) => {
      queryClient.setQueryData(CART_KEY, cart);
    },
  });
}

export function useAddToCart() {
  return useOptimisticCart<AddItemInput>((input) =>
    bff<CartDto>('cart/items', { method: 'POST', json: input }),
  );
}

export function useSetQuantity() {
  return useOptimisticCart<{ lineId: string; quantity: number }>(
    ({ lineId, quantity }) =>
      bff<CartDto>(`cart/items/${lineId}`, { method: 'PATCH', json: { quantity } }),
    (cart, { lineId, quantity }) => withQuantity(cart, lineId, quantity),
  );
}

export function useRemoveLine() {
  return useOptimisticCart<{ lineId: string }>(
    ({ lineId }) => bff<CartDto>(`cart/items/${lineId}`, { method: 'DELETE' }),
    (cart, { lineId }) => withoutLine(cart, lineId),
  );
}

export function useReplaceDecision() {
  return useOptimisticCart<{ lineId: string; blueprintDecisionId: string }>(
    ({ lineId, blueprintDecisionId }) =>
      bff<CartDto>(`cart/items/${lineId}/decision`, {
        method: 'PUT',
        json: { blueprintDecisionId },
      }),
  );
}
