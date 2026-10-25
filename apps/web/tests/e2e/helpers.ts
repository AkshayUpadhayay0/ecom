import type { PublicProductListDto } from '@urban-ibile/shared';
import { expect, type Locator, type Page } from '@playwright/test';

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

/** Opens the side menu from the header and returns it (a modal dialog named "Menu"). */
export async function openMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toBeVisible();
  return menu;
}
