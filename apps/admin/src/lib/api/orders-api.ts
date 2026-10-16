import type {
  AdminOrderDetailDto,
  AdminOrderNoteDto,
  AdminOrderSummaryDto,
  UpdateOrderStatusRequest,
} from '@urban-ibile/shared';
import { getData, getList, send } from './http';

export interface OrderListParams {
  page?: number;
  q?: string;
  orderStatus?: string;
  paymentStatus?: string;
  from?: string;
  to?: string;
  deliveryZoneId?: string;
  needsAttention?: string;
}

/** Admin orders (Phase 7a API). Every admin role may read, change status and add notes. */
export const ordersApi = {
  list: (params: OrderListParams) => getList<AdminOrderSummaryDto>('/admin/orders', { ...params }),
  get: (id: string) => getData<AdminOrderDetailDto>(`/admin/orders/${id}`),
  updateStatus: (id: string, body: UpdateOrderStatusRequest) =>
    send<AdminOrderDetailDto>('PATCH', `/admin/orders/${id}/status`, body),
  addNote: (id: string, body: string) =>
    send<AdminOrderNoteDto>('POST', `/admin/orders/${id}/notes`, { body }),
};
