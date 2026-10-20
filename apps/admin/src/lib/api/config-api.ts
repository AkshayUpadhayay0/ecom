import {
  MAX_PAGE_SIZE,
  type AdminHiddenPageDto,
  type AuditLogDto,
  type ContentBlockDto,
  type ContentBlockSummaryDto,
  type CreateDeliveryZoneRequest,
  type DeliveryZoneDto,
  type SerialBatchDto,
  type SerialDto,
  type SerialImportResultDto,
  type SettingDto,
  type UpdateDeliveryZoneRequest,
  type UpdateContentTextRequest,
  type UpdateHiddenPageContentRequest,
} from '@urban-ibile/shared';
import { apiRequest } from './client';
import { getData, getList, send, toQueryString } from './http';
import type { ListParams } from './catalog';

/** Delivery zones, settings, content blocks, hidden (QR) pages + serials, audit log. */
export const configApi = {
  zones: (params: ListParams) =>
    getList<DeliveryZoneDto>('/admin/delivery-zones', { pageSize: MAX_PAGE_SIZE, ...params }),
  createZone: (body: CreateDeliveryZoneRequest) =>
    send<DeliveryZoneDto>('POST', '/admin/delivery-zones', body),
  updateZone: (id: string, body: UpdateDeliveryZoneRequest) =>
    send<DeliveryZoneDto>('PATCH', `/admin/delivery-zones/${id}`, body),

  settings: () => getData<SettingDto[]>('/admin/settings'),
  updateSetting: (key: string, value: unknown) =>
    send<SettingDto>('PATCH', `/admin/settings/${encodeURIComponent(key)}`, { value }),

  contentBlocks: () =>
    getList<ContentBlockSummaryDto>('/admin/content-blocks', { pageSize: MAX_PAGE_SIZE }),
  contentBlock: (key: string) =>
    getData<ContentBlockDto>(`/admin/content-blocks/${encodeURIComponent(key)}`),
  publishBlock: (key: string) =>
    send<ContentBlockDto>('POST', `/admin/content-blocks/${encodeURIComponent(key)}/publish`),
  unpublishBlock: (key: string) =>
    send<ContentBlockDto>('POST', `/admin/content-blocks/${encodeURIComponent(key)}/unpublish`),
  /** Text blocks only (footer, policies): English plain-text title and body. */
  setBlockText: (key: string, text: UpdateContentTextRequest) =>
    send<ContentBlockDto>('PUT', `/admin/content-blocks/${encodeURIComponent(key)}/text`, text),
  setBlockMedia: (key: string, mediaAssetId: string | null) =>
    send<ContentBlockDto>('PUT', `/admin/content-blocks/${encodeURIComponent(key)}/media`, {
      mediaAssetId,
    }),

  hiddenPages: () =>
    getList<AdminHiddenPageDto>('/admin/hidden-pages', { pageSize: MAX_PAGE_SIZE }),
  hiddenPage: (id: string) => getData<AdminHiddenPageDto>(`/admin/hidden-pages/${id}`),
  updateHiddenPage: (id: string, body: UpdateHiddenPageContentRequest) =>
    send<AdminHiddenPageDto>('PUT', `/admin/hidden-pages/${id}/content`, body),
  /** CSV body (text/csv). The API hashes serials; nothing is ever returned in plaintext. */
  importSerials: async (csv: string, options: { sourceName?: string; dryRun: boolean }) =>
    (
      await apiRequest<{ data: SerialImportResultDto }>(
        `/admin/serial-imports${toQueryString({ sourceName: options.sourceName, dryRun: options.dryRun })}`,
        { method: 'POST', text: { content: csv, contentType: 'text/csv' } },
      )
    ).data,
  serialBatches: (params: ListParams) => getList<SerialBatchDto>('/admin/serial-batches', params),
  deactivateSerial: (serial: string) =>
    send<SerialDto>('POST', '/admin/serials/deactivate', { serial }),

  auditLogs: (params: ListParams) => getList<AuditLogDto>('/admin/audit-logs', params),
};
