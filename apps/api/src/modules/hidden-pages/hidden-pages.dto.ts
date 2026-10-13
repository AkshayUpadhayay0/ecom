import type { AdminHiddenPageDto } from '@urban-ibile/shared';
import type { HiddenPageRow } from './hidden-pages.repository.js';

/** Path of the customer-website page the QR code opens (team design; domain still pending). */
export const HIDDEN_PAGE_PUBLIC_PATH = '/h/';

export function hiddenPagePublicUrl(publicWebUrl: string, routeToken: string): string {
  return `${publicWebUrl.replace(/\/+$/, '')}${HIDDEN_PAGE_PUBLIC_PATH}${routeToken}`;
}

export function toAdminHiddenPageDto(row: HiddenPageRow, publicWebUrl: string): AdminHiddenPageDto {
  return {
    id: row.id,
    slotNumber: row.slotNumber,
    slug: row.slug,
    routeToken: row.routeToken,
    publicUrl: hiddenPagePublicUrl(publicWebUrl, row.routeToken),
    exclusiveOnly: row.exclusiveOnly,
    isPublished: row.isPublished,
    tokenLockedAt: row.tokenLockedAt?.toISOString() ?? null,
    title: row.title,
    body: row.body,
    updatedAt: row.updatedAt.toISOString(),
  };
}
