import type { CartDto, CartLineDto } from '@urban-ibile/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BffError } from '@/lib/client/bff';
import type * as BffModule from '@/lib/client/bff';
import { CART_KEY, useRemoveLine, useSetQuantity } from './hooks';
import { blockingWarnings, clampQuantity, withQuantity, withoutLine } from './model';

const bffMock = vi.fn();
vi.mock('@/lib/client/bff', async (importOriginal) => ({
  ...(await importOriginal<typeof BffModule>()),
  bff: (...args: unknown[]) => bffMock(...args) as unknown,
}));

function line(
  id: string,
  quantity: number,
  unit: number,
  warnings: CartLineDto['warnings'] = [],
): CartLineDto {
  return {
    id,
    product: { id: `p-${id}`, slug: id, name: id },
    size: { id: 's', code: 'L', label: 'Large' },
    quantity,
    unitPriceMinor: unit,
    lineTotalMinor: unit * quantity,
    addedUnitPriceMinor: unit,
    decision: null,
    warnings,
  };
}

const cart: CartDto = {
  id: 'c',
  currency: 'NGN',
  lines: [line('a', 1, 1000), line('b', 2, 500), line('gone', 1, 9999, ['UNAVAILABLE'])],
  itemCount: 4,
  subtotalMinor: 2000,
  canCheckout: false,
  maxQuantityPerLine: 10,
};

describe('cart model', () => {
  it('recomputes line total, item count and subtotal (unavailable lines excluded) for a new quantity', () => {
    const next = withQuantity(cart, 'a', 3);
    expect(next.lines[0]?.lineTotalMinor).toBe(3000);
    expect(next.itemCount).toBe(6);
    expect(next.subtotalMinor).toBe(4000);
    expect(cart.lines[0]?.quantity).toBe(1); // the original is untouched
  });
  it('removes a line', () => {
    const next = withoutLine(cart, 'b');
    expect(next.lines.map((l) => l.id)).toEqual(['a', 'gone']);
    expect(next.subtotalMinor).toBe(1000);
  });
  it('keeps the quantity inside 1..max', () => {
    expect(clampQuantity(0, 10)).toBe(1);
    expect(clampQuantity(11, 10)).toBe(10);
    expect(clampQuantity(3.9, 10)).toBe(3);
  });
  it('treats price changes as non-blocking', () => {
    expect(blockingWarnings(line('x', 1, 1, ['PRICE_CHANGED', 'STOCK_LOW']))).toEqual([
      'STOCK_LOW',
    ]);
  });
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(CART_KEY, cart);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('optimistic cart updates', () => {
  beforeEach(() => {
    bffMock.mockReset();
  });

  it('shows the change at once and then takes the server answer', async () => {
    const { client, wrapper } = setup();
    const serverCart = withQuantity(cart, 'a', 3);
    let release: (value: CartDto) => void = () => undefined;
    bffMock.mockReturnValue(
      new Promise<CartDto>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useSetQuantity(), { wrapper });

    act(() => {
      result.current.mutate({ lineId: 'a', quantity: 3 });
    });
    await waitFor(() => {
      expect(client.getQueryData<CartDto>(CART_KEY)?.itemCount).toBe(6);
    });

    act(() => {
      release({ ...serverCart, subtotalMinor: 4100 });
    });
    await waitFor(() => {
      expect(client.getQueryData<CartDto>(CART_KEY)?.subtotalMinor).toBe(4100);
    });
  });

  it('rolls back to the previous cart when the server refuses (over stock / limit)', async () => {
    const { client, wrapper } = setup();
    bffMock.mockRejectedValueOnce(new BffError(409, 'INSUFFICIENT_STOCK', 'x'));
    bffMock.mockResolvedValue(cart); // the re-sync after the failure
    const { result } = renderHook(() => useSetQuantity(), { wrapper });

    await act(async () => {
      result.current.mutate({ lineId: 'a', quantity: 9 });
      await vi.waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
    expect(client.getQueryData<CartDto>(CART_KEY)?.lines[0]?.quantity).toBe(1);
    expect(result.current.error).toBeInstanceOf(BffError);
  });

  it('rolls a removal back too', async () => {
    const { client, wrapper } = setup();
    bffMock.mockRejectedValueOnce(new BffError(0, 'NETWORK_ERROR', 'x'));
    bffMock.mockResolvedValue(cart);
    const { result } = renderHook(() => useRemoveLine(), { wrapper });
    await act(async () => {
      result.current.mutate({ lineId: 'b' });
      await vi.waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
    expect(client.getQueryData<CartDto>(CART_KEY)?.lines).toHaveLength(3);
  });
});
