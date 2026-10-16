import { useQuery } from '@tanstack/react-query';
import { catalogApi, type ListParams } from '@/lib/api/catalog';

export const catalogKeys = {
  all: ['catalog'] as const,
  products: (params: ListParams) => [...catalogKeys.all, 'products', params] as const,
  product: (id: string) => [...catalogKeys.all, 'product', id] as const,
  preview: (slug: string) => [...catalogKeys.all, 'preview', slug] as const,
  clothingTypes: () => [...catalogKeys.all, 'clothing-types'] as const,
  sizes: () => [...catalogKeys.all, 'sizes'] as const,
  profiles: () => [...catalogKeys.all, 'profiles'] as const,
  variants: (productId: string) => [...catalogKeys.all, 'variants', productId] as const,
  movements: (variantId: string, page: number) =>
    [...catalogKeys.all, 'movements', variantId, page] as const,
  lowStock: (page: number) => [...catalogKeys.all, 'low-stock', page] as const,
  media: (params: ListParams) => [...catalogKeys.all, 'media', params] as const,
};

export function useProducts(params: ListParams) {
  return useQuery({
    queryKey: catalogKeys.products(params),
    queryFn: () => catalogApi.products(params),
  });
}

export function useProduct(id: string) {
  return useQuery({ queryKey: catalogKeys.product(id), queryFn: () => catalogApi.product(id) });
}

export function useClothingTypes() {
  return useQuery({
    queryKey: catalogKeys.clothingTypes(),
    queryFn: async () => (await catalogApi.clothingTypes()).data,
  });
}

export function useSizesList() {
  return useQuery({
    queryKey: catalogKeys.sizes(),
    queryFn: async () => (await catalogApi.sizes()).data,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: catalogKeys.profiles(),
    queryFn: async () => (await catalogApi.profiles()).data,
  });
}

export function useVariants(productId: string) {
  return useQuery({
    queryKey: catalogKeys.variants(productId),
    queryFn: async () => (await catalogApi.variants(productId)).data,
  });
}
