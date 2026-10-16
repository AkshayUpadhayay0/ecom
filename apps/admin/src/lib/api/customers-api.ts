import type { AdminCustomerDetailDto, AdminCustomerSummaryDto } from '@urban-ibile/shared';
import { getData, getList, send } from './http';

/** Customer lookup (Phase 7a API). Reading: every admin. Suspend/enable: super_admin only. */
export const customersApi = {
  list: (params: { q?: string; status?: string; page?: number }) =>
    getList<AdminCustomerSummaryDto>('/admin/customers', params),
  get: (id: string) => getData<AdminCustomerDetailDto>(`/admin/customers/${id}`),
  setStatus: (id: string, body: { status: 'active' | 'suspended'; reason: string }) =>
    send<AdminCustomerDetailDto>('PATCH', `/admin/customers/${id}/status`, body),
};
