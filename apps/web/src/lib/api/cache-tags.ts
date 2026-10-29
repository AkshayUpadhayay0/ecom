/**
 * Cache tags on the website's fetches of public API data. The API calls /api/revalidate with these
 * names after an admin change (or when media becomes ready) and Next drops the tagged data and the
 * pages built from it. Keep in step with REVALIDATE_TAGS in apps/api/src/lib/web-revalidate.ts.
 */
export const CATALOG_TAG = 'catalog';
export const SITE_TAG = 'site';
export const REVALIDATE_TAGS: readonly string[] = [CATALOG_TAG, SITE_TAG];
