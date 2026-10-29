import {
  MAX_PAGE_SIZE,
  type ArchiveVariantRequest,
  type ChangeProductStatusRequest,
  type ClothingTypeDto,
  type CreateClothingTypeRequest,
  type CreateProductRequest,
  type CreateUploadResultDto,
  type CreateVariantRequest,
  type LowStockVariantDto,
  type MeasurementProfileDto,
  type MediaAssetDto,
  type MediaDeletionResultDto,
  type MediaLibraryItemDto,
  type MediaUrlDto,
  type MediaUsageDto,
  type ProductDeletionResultDto,
  type ProductDto,
  type ProductSummaryDto,
  type PublicProductDetailDto,
  type PurgeRetiredResultDto,
  type SizeDto,
  type StockAdjustmentRequest,
  type StockAdjustmentResultDto,
  type StockMovementDto,
  type UpdateClothingTypeRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  type VariantArchiveResultDto,
  type VariantDto,
} from '@urban-ibile/shared';
import { ApiError, apiRequest } from './client';
import { getData, getList, send } from './http';

export type ListParams = Record<string, string | number | boolean | undefined>;

/** Admin catalogue, inventory and media endpoints (apps/api catalog / inventory / media). */
export const catalogApi = {
  // Products
  products: (params: ListParams) => getList<ProductSummaryDto>('/admin/products', params),
  product: (id: string) => getData<ProductDto>(`/admin/products/${id}`),
  createProduct: (body: CreateProductRequest) => send<ProductDto>('POST', '/admin/products', body),
  updateProduct: (id: string, body: UpdateProductRequest) =>
    send<ProductDto>('PATCH', `/admin/products/${id}`, body),
  changeProductStatus: (id: string, body: ChangeProductStatusRequest) =>
    send<ProductDto>('POST', `/admin/products/${id}/status`, body),
  /** Soft delete: removed from the shop; order history keeps its own copy. */
  deleteProduct: (id: string) => send<ProductDeletionResultDto>('DELETE', `/admin/products/${id}`),
  setProductVideo: (id: string, mediaAssetId: string) =>
    send<ProductDto>('PUT', `/admin/products/${id}/video`, { mediaAssetId }),
  setProductImages: (id: string, mediaAssetIds: string[]) =>
    send<ProductDto>('PUT', `/admin/products/${id}/images`, { mediaAssetIds }),
  /** What the public catalogue (storefront) returns for this product; 404 when not public. */
  storefrontPreview: (slug: string) =>
    apiRequest<{ data: PublicProductDetailDto }>(`/catalog/products/${encodeURIComponent(slug)}`, {
      auth: false,
    }).then((body) => body.data),

  // Reference data
  clothingTypes: (params: ListParams = {}) =>
    getList<ClothingTypeDto>('/admin/clothing-types', { pageSize: MAX_PAGE_SIZE, ...params }),
  createClothingType: (body: CreateClothingTypeRequest) =>
    send<ClothingTypeDto>('POST', '/admin/clothing-types', body),
  updateClothingType: (id: string, body: UpdateClothingTypeRequest) =>
    send<ClothingTypeDto>('PATCH', `/admin/clothing-types/${id}`, body),
  sizes: () => getList<SizeDto>('/admin/sizes', { pageSize: MAX_PAGE_SIZE }),
  profiles: () =>
    getList<MeasurementProfileDto>('/admin/measurement-profiles', { pageSize: MAX_PAGE_SIZE }),

  // Inventory
  variants: (productId: string) =>
    getList<VariantDto>(`/admin/products/${productId}/variants`, { pageSize: MAX_PAGE_SIZE }),
  createVariant: (productId: string, body: CreateVariantRequest) =>
    send<VariantDto>('POST', `/admin/products/${productId}/variants`, body),
  updateVariant: (id: string, body: UpdateVariantRequest) =>
    send<VariantDto>('PATCH', `/admin/variants/${id}`, body),
  /** Delete a size = archive it (stock written off via the ledger first). */
  archiveVariant: (id: string, body: ArchiveVariantRequest) =>
    send<VariantArchiveResultDto>('DELETE', `/admin/variants/${id}`, body),
  adjustStock: (id: string, body: StockAdjustmentRequest) =>
    send<StockAdjustmentResultDto>('POST', `/admin/variants/${id}/stock-adjustments`, body),
  movements: (id: string, params: ListParams) =>
    getList<StockMovementDto>(`/admin/variants/${id}/stock-movements`, params),
  lowStock: (params: ListParams) =>
    getList<LowStockVariantDto>('/admin/inventory/low-stock', params),

  // Media
  /** Media Library (every admin; public media only, with Used by). */
  media: (params: ListParams) => getList<MediaLibraryItemDto>('/admin/media', params),
  /** "Choose existing" (every admin): public, ready, non-retired media no customer owns. */
  mediaPicker: (params: ListParams) => getList<MediaAssetDto>('/admin/media/picker', params),
  /** Where a public asset is used (what a delete would change). */
  mediaUsage: (id: string) => getData<MediaUsageDto>(`/admin/media/${id}/usage`),
  /** Detach everywhere + retire; files stay until a super admin purges them. */
  deleteMedia: (id: string) => send<MediaDeletionResultDto>('DELETE', `/admin/media/${id}`),
  /** Requeue failed processing of public product media. */
  retryMedia: (id: string) => send<MediaAssetDto>('POST', `/admin/media/${id}/retry`),
  mediaAsset: (id: string) => getData<MediaAssetDto>(`/admin/media/${id}`),
  mediaUrl: (id: string) => getData<MediaUrlDto>(`/admin/media/${id}/url`),
  createUpload: (body: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    visibility: 'public' | 'private';
    isTemporary: boolean;
  }) => send<CreateUploadResultDto>('POST', '/admin/media/uploads', body),
  completeUpload: (id: string) => send<MediaAssetDto>('POST', `/admin/media/${id}/complete`),
  purge: (id: string) => send<MediaAssetDto>('POST', `/admin/media/${id}/purge`),
  purgeRetired: () => send<PurgeRetiredResultDto>('POST', '/admin/media/purge-retired'),
};

const HTTP = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  UNSUPPORTED: 415,
  SERVER_ERROR: 500,
} as const;

/** Friendly cause for a storage answer that was not a success (storage speaks XML/plain text, not our JSON). */
export function describeStorageStatus(status: number): string {
  switch (status) {
    case HTTP.FORBIDDEN:
      return 'Storage refused the upload: the upload link has expired or does not match the file. Choose the file again and retry.';
    case HTTP.TOO_LARGE:
      return 'Storage says this file is too large. Choose a smaller file.';
    case HTTP.UNSUPPORTED:
    case HTTP.BAD_REQUEST:
      return 'Storage did not accept this file (type or size). Use an MP4, MOV or WebM video, or a JPEG, PNG or WebP image.';
    case HTTP.NOT_FOUND:
      return 'Storage could not find where to put the file (the upload link is no longer valid). Retry the upload.';
    default:
      return status >= HTTP.SERVER_ERROR
        ? 'Storage is having trouble right now. Wait a moment and retry.'
        : `Storage answered with an unexpected status (HTTP ${status}).`;
  }
}

async function storageRejection(response: Response): Promise<ApiError> {
  // The local development storage answers with the API's own JSON errors (file too large, wrong type...).
  const body: unknown = await response.json().catch(() => undefined);
  const error = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  if (typeof error?.message === 'string') {
    return new ApiError('UPLOAD_FAILED', response.status, error.message);
  }
  return new ApiError('UPLOAD_FAILED', response.status, describeStorageStatus(response.status));
}

/**
 * Sends the file straight to storage with the presigned PUT (the API never proxies bytes). Every
 * failure becomes an ApiError with the real, plain-language cause: offline, blocked / dropped
 * (usually storage CORS or a lost connection), or the status storage answered with.
 */
export async function putToStorage(
  upload: CreateUploadResultDto['upload'],
  file: File,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'UPLOAD_FAILED',
      0,
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'You appear to be offline. Check your internet connection, then retry the upload.'
        : 'The file could not be sent to storage: the connection dropped or the browser blocked the upload. Retry; if it keeps happening, storage may not allow uploads from this site (CORS): ask a developer.',
    );
  }
  if (!response.ok) throw await storageRejection(response);
}

/**
 * The same upload with REAL progress (fetch cannot report upload progress, XMLHttpRequest can) and
 * cancel support. Errors are the same plain-language ApiErrors as putToStorage.
 */
export function putToStorageWithProgress(
  upload: CreateUploadResultDto['upload'],
  file: File,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size, file.size);
        resolve();
        return;
      }
      void storageRejection(new Response(xhr.responseText, { status: xhr.status })).then(reject);
    };
    xhr.onerror = () => {
      reject(
        new ApiError(
          'UPLOAD_FAILED',
          0,
          typeof navigator !== 'undefined' && !navigator.onLine
            ? 'You appear to be offline. Check your internet connection, then retry the upload.'
            : 'The file could not be sent to storage: the connection dropped or the browser blocked the upload. Retry; if it keeps happening, storage may not allow uploads from this site (CORS): ask a developer.',
        ),
      );
    };
    xhr.onabort = () => {
      reject(new ApiError('UPLOAD_FAILED', 0, 'The upload was cancelled.'));
    };
    signal?.addEventListener('abort', () => {
      xhr.abort();
    });
    xhr.send(file);
  });
}
