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
import { apiRequest } from './client';
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
  /** Media Library (super_admin only). */
  media: (params: ListParams) => getList<MediaAssetDto>('/admin/media', params),
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

/** Sends the file straight to storage with the presigned PUT (the API never proxies bytes). */
export async function putToStorage(
  upload: CreateUploadResultDto['upload'],
  file: File,
): Promise<void> {
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`);
}
