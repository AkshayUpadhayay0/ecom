/**
 * Demo catalogue plan and safety guard (pnpm seed:demo / seed:demo:remove).
 * Pure functions only: the script in scripts/seed-demo.ts does the work through the normal
 * services. Everything the demo creates is recognisable by the markers below, and removal touches
 * nothing else.
 */

/** The documented local development database; the demo seed refuses any other name. */
export const DEMO_DEV_DATABASE = 'ecom';

export const DEMO = {
  /** Product slug / name markers ("Demo outfit 01" ... "demo-outfit-01"). */
  slugPrefix: 'demo-outfit-',
  namePrefix: 'Demo outfit',
  /** Searchable marker stored on every demo product. */
  keyword: 'demo-seed',
  /** Variant SKU prefix. */
  skuPrefix: 'DEMO-',
  /** Uploaded file names start with this, so every demo media asset is recognisable (and is also flagged is_temporary). */
  filePrefix: 'demo-seed-',
  description:
    'DEMO PRODUCT: sample data created by pnpm seed:demo. Not a real outfit. Remove it with pnpm seed:demo:remove.',
  productCount: 24,
} as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface DemoGuardInput {
  nodeEnv: string | undefined;
  databaseUrl: string;
  /** Name of the dev database (default "ecom"; DEMO_SEED_DATABASE overrides it). */
  allowedDatabase?: string | undefined;
}

/** Throws unless this is NOT production and the database is the local, configured dev database. */
export function assertDemoSeedAllowed({
  nodeEnv,
  databaseUrl,
  allowedDatabase,
}: DemoGuardInput): void {
  if (nodeEnv === 'production') {
    throw new Error('The demo seed creates sample data and is refused in production.');
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expected = allowedDatabase ?? DEMO_DEV_DATABASE;
  if (name !== expected) {
    throw new Error(
      `The demo seed only runs on the development database "${expected}", not "${name}". ` +
        'Set DEMO_SEED_DATABASE if your development database has another name.',
    );
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`The demo seed only runs on a local database, not on "${url.hostname}".`);
  }
}

export type DemoMedia = 'video' | 'photos' | 'none';

export interface DemoProduct {
  number: number;
  name: string;
  slug: string;
  /** Clothing type slug. */
  typeSlug: 'shirt' | 'trouser';
  priceMinor: number;
  media: DemoMedia;
  /** How many photos (photos only). */
  photoCount: number;
  /** Uses the male top Blueprint profile (Find My Size demo). */
  blueprint: boolean;
  /** Units on hand per size, in size order (shorter lists mean fewer sizes). */
  stock: number[];
}

const PROFILE_PRODUCT = 22;
const NO_MEDIA_PRODUCT = 21;
const SOLD_OUT_PRODUCT = 23;
const LOW_STOCK_PRODUCT = 24;
const VIDEO_PRODUCTS = [1, 2, 3, 4, 5, PROFILE_PRODUCT];
const BASE_PRICE_MINOR = 1_500_000; // SAMPLE prices: NGN 15,000 to 50,000
const PRICE_STEP_MINOR = 500_000;
const PRICE_STEPS = 8;
const MAX_PHOTOS = 3;

function twoDigits(n: number): string {
  return String(n).padStart(2, '0');
}

function stockFor(n: number): number[] {
  if (n === SOLD_OUT_PRODUCT) return [0, 0, 0];
  if (n === LOW_STOCK_PRODUCT) return [2, 1, 0];
  if (n === PROFILE_PRODUCT) return [6, 5, 4, 3, 2];
  return [8, 6, 4].map((units) => units + (n % 3));
}

/** The 24 demo products: videos, photo-only, one without media, one Blueprint, sold out, low stock. */
export function planDemoProducts(): DemoProduct[] {
  return Array.from({ length: DEMO.productCount }, (_, index) => {
    const number = index + 1;
    const media: DemoMedia =
      number === NO_MEDIA_PRODUCT ? 'none' : VIDEO_PRODUCTS.includes(number) ? 'video' : 'photos';
    return {
      number,
      name: `${DEMO.namePrefix} ${twoDigits(number)}`,
      slug: `${DEMO.slugPrefix}${twoDigits(number)}`,
      typeSlug: number === PROFILE_PRODUCT || number % 2 === 1 ? 'shirt' : 'trouser',
      priceMinor: BASE_PRICE_MINOR + (number % PRICE_STEPS) * PRICE_STEP_MINOR,
      media,
      photoCount: media === 'photos' ? (number % MAX_PHOTOS) + 1 : 0,
      blueprint: number === PROFILE_PRODUCT,
      stock: stockFor(number),
    };
  });
}

/** Placeholder videos use ffmpeg's built-in test patterns (no files, no network, no fonts). */
export const DEMO_VIDEO_PATTERNS = [
  'testsrc2',
  'smptebars',
  'mandelbrot',
  'rgbtestsrc',
  'yuvtestsrc',
] as const;

export function isDemoSlug(slug: string): boolean {
  return slug.startsWith(DEMO.slugPrefix);
}
