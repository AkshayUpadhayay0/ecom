/**
 * Public brand name shown on screen (header link label, hero, footer, page titles, manifest).
 * PENDING CLIENT CONFIRMATION: the client's wordmark is spelled "Urban Ìbílé" (with diacritics), so
 * that is what is displayed. Change this ONE line to switch the whole site.
 */
export const BRAND_NAME = 'Urban Ìbílé';

/**
 * Plain ASCII spelling ("Urban Ibile"), derived from BRAND_NAME so it never drifts. Used where a
 * searchable or machine-facing name is wanted next to the display name: Open Graph site name,
 * metadata keywords, structured data. URLs, slugs and the domain stay ASCII.
 */
export const BRAND_NAME_ASCII = BRAND_NAME.normalize('NFD').replace(/\p{M}/gu, '');
