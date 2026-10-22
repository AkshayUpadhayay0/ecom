import type { PublicProductListDto } from '@urban-ibile/shared';

/** The API the e2e stack runs (see playwright.config.ts). */
export const API_URL = 'http://localhost:4010';

export async function apiProducts(query = ''): Promise<PublicProductListDto> {
  const response = await fetch(`${API_URL}/api/v1/catalog/products${query}`);
  return (await response.json()) as PublicProductListDto;
}

export const SEEDED = {
  noVideo: 'e2e-no-video',
  withVideo: 'e2e-with-video',
  zanzibarName: 'Zanzibar Linen Agbada',
  soldOutName: 'E2E Sold Out Trouser',
} as const;

export const NO_RESULTS_TEXT = 'No outfits found. Try another word.';
