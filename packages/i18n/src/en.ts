/**
 * English UI copy. Complete: every key lives here. Product names, prices and search terms are
 * data and never pass through this table. Keys are flat and dotted so other languages (and the
 * mobile app) can supply any subset.
 */
export const en = {
  'a11y.skip_to_content': 'Skip to main content',
  'a11y.logo_home': '{brand}, home',

  'nav.primary': 'Main navigation',
  'nav.shop': 'Shop',
  'nav.search': 'Search',

  'header.search_label': 'Search outfits',
  'header.search_placeholder': 'Search outfits',
  'header.open_search': 'Open search',
  'header.close_search': 'Close search',

  'search.title': 'Search',
  'search.submit': 'Search',
  'search.heading_for': 'Results for "{query}"',
  'search.prompt': 'Type a word to search every outfit.',
  'search.no_results': 'No outfits found. Try another word.',
  'search.results_count': '{total} found',

  'home.featured_heading': 'New outfits',
  'home.view_all': 'See all outfits',
  'home.hero_fallback_cta': 'Shop outfits',
  'home.hero_label': 'Featured video',

  'shop.title': 'Shop',
  'shop.results_count': '{total} outfits',
  'shop.empty': 'No outfits to show yet.',
  'shop.filter_label': 'Clothing type',
  'shop.filter_all': 'All',
  'shop.sort_label': 'Sort by',
  'shop.sort_newest': 'Newest',
  'shop.sort_price_asc': 'Price: low to high',
  'shop.sort_price_desc': 'Price: high to low',
  'shop.sort_name': 'Name',
  'shop.apply': 'Apply',

  'pagination.label': 'Pages',
  'pagination.previous': 'Previous',
  'pagination.next': 'Next',
  'pagination.status': 'Page {page} of {total}',
  'pagination.go_to': 'Go to page {page}',

  'product.out_of_stock': 'Out of stock',
  'product.view': 'View {name}',
  'product.sizes': 'Sizes',
  'product.description': 'Description',
  'product.type': 'Type',
  'product.gallery': 'Photos',
  'product.video_label': 'Product video',
  'product.blueprint_applies':
    'This outfit has a Blueprint fit: your size is worked out from your body measurements.',
  'product.blueprint_measurements': 'Measurements needed',
  'product.blueprint_none': 'This outfit has no Blueprint fit. Choose a size from the list.',
  'size.in_stock': 'In stock',
  'size.low_stock': 'Low stock',
  'size.out_of_stock': 'Out of stock',

  'video.play': 'Play video',
  'video.pause': 'Pause video',

  'footer.heading_about': 'About',
  'footer.about_pending': 'More information is coming soon.',
  'footer.rights': '© {year} {brand}',
  'footer.nav': 'Footer navigation',

  'language.label': 'Language',
  'language.en': 'English',
  'language.pcm': 'Pidgin',

  'error.title': 'Something went wrong',
  'error.body': 'We could not load this page. Please try again.',
  'error.retry': 'Try again',
  'notfound.title': 'Page not found',
  'notfound.body': 'We could not find what you were looking for.',
  'notfound.cta': 'Back to shop',
} as const;
