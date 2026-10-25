/** Static tuning values for the storefront. Business values (page size, prices) come from the API. */

/** Cookie holding the chosen language (set by the language switcher). */
export const LANGUAGE_COOKIE = 'ui_lang';

/** Seconds the server may reuse catalogue/site responses (matches the API's 60 s caching). */
export const CATALOG_REVALIDATE_SECONDS = 60;

/* Page-level 
evalidate exports are literal 60 (Next needs a static value): keep in step with the above. */

/** How many outfits the homepage shows (desktop / mobile; extra cards are hidden by CSS on mobile). */
export const HOME_FEATURED_DESKTOP = 8;
export const HOME_FEATURED_MOBILE = 4;

/** Videos that may play at the same time across the page. */
export const MAX_CONCURRENT_VIDEOS = 4;
/** Cards start loading their loop slightly before they scroll into view. */
export const VIDEO_ROOT_MARGIN = '200px 0px';
/** Fraction of a card that must be visible before it asks for a play slot. */
export const VIDEO_VISIBLE_THRESHOLD = 0.35;

/** Search box: wait this long after the last keystroke before navigating. */
export const SEARCH_DEBOUNCE_MS = 350;

/** Longest search text accepted before it is cut (the API limit is the same). */
export { SEARCH_MAX_LENGTH } from '@urban-ibile/shared';

/** The header turns solid once the hero's bottom edge passes this many px from the top (the header height). */
export const HEADER_SOLID_OFFSET_PX = 72;

/** Product aspect ratio for card media (width / height). Portrait fashion video. */
export const CARD_ASPECT = '4 / 5';

/** Sitemap pages through the catalogue in chunks of this size (API maximum is 50). */
export const SITEMAP_PAGE_SIZE = 50;

/** Connection types treated as slow (posters only, smaller renditions). */
export const SLOW_CONNECTION_TYPES = ['slow-2g', '2g', '3g'] as const;
