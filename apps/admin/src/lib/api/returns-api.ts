import type {
  AdminReturnDetailDto,
  AdminReturnSummaryDto,
  AdvanceReturnRequest,
  InspectReturnRequest,
  SetReturnResponsibilityRequest,
} from '@urban-ibile/shared';
import { getData, getList, send } from './http';

export interface ReturnListParams {
  page?: number;
  q?: string;
  status?: string;
  requestType?: string;
  responsibility?: string;
  reasonCode?: string;
  open?: string;
}

type Detail = AdminReturnDetailDto;
const path = (id: string, action: string) => `/admin/returns/${id}/${action}`;

/** Admin returns / exchanges / Fault-Line (Phase 7b API). Responsibility: super_admin only. */
export const returnsApi = {
  list: (params: ReturnListParams) =>
    getList<AdminReturnSummaryDto>('/admin/returns', { ...params }),
  get: (id: string) => getData<Detail>(`/admin/returns/${id}`),
  approve: (id: string, body: { expectedStatus: string; note?: string }) =>
    send<Detail>('POST', path(id, 'approve'), body),
  reject: (id: string, body: { expectedStatus: string; reason: string }) =>
    send<Detail>('POST', path(id, 'reject'), body),
  requestInfo: (id: string, body: { expectedStatus: string; message: string }) =>
    send<Detail>('POST', path(id, 'request-info'), body),
  markReceived: (id: string, body: { expectedStatus: string; note?: string }) =>
    send<Detail>('POST', path(id, 'mark-received'), body),
  advance: (id: string, body: AdvanceReturnRequest) =>
    send<Detail>('POST', path(id, 'status'), body),
  inspect: (id: string, body: InspectReturnRequest) =>
    send<Detail>('POST', path(id, 'inspect'), body),
  setResponsibility: (id: string, body: SetReturnResponsibilityRequest) =>
    send<Detail>('PATCH', path(id, 'responsibility'), body),
  addNote: (id: string, body: string) => send<unknown>('POST', path(id, 'notes'), { body }),
};
