import { useQuery } from '@tanstack/react-query';
import { ordersApi, type OrderListParams } from '@/lib/api/orders-api';

export const orderKeys = {
  all: ['orders'] as const,
  list: (params: OrderListParams) => [...orderKeys.all, 'list', params] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

export function useOrders(params: OrderListParams) {
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: () => ordersApi.list(params),
    placeholderData: (previous) => previous,
  });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: orderKeys.detail(id), queryFn: () => ordersApi.get(id) });
}
