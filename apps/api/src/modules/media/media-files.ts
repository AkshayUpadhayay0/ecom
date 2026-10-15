import type { MediaKind, MediaMimeType, MediaVisibility } from '@urban-ibile/shared';
import type { Bucket } from './storage/storage-provider.js';

/** Bytes read from the start of an upload to check its real type. */
export const MAGIC_BYTES_LENGTH = 32;
const FILE_NAME_MAX_LENGTH = 120;
const FALLBACK_FILE_NAME = 'upload';

const ascii = (bytes: Buffer, start: number, end: number): string =>
  bytes.subarray(start, end).toString('latin1');
const startsWith = (bytes: Buffer, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

/** ISO base media (MP4 / QuickTime): an atom type at offset 4. */
const ISO_ATOMS = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);
const QUICKTIME_BRAND = 'qt  ';

const MAGIC: Record<MediaMimeType, (bytes: Buffer) => boolean> = {
  'video/mp4': (b) => ascii(b, 4, 8) === 'ftyp' && ascii(b, 8, 12) !== QUICKTIME_BRAND,
  'video/quicktime': (b) => ISO_ATOMS.has(ascii(b, 4, 8)),
  'video/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
};

/** True when the first bytes of the object match the declared type. */
export function matchesMagicBytes(mimeType: MediaMimeType, firstBytes: Buffer): boolean {
  return MAGIC[mimeType](firstBytes);
}

/**
 * Display-only file name: no directories, control characters or unusual symbols. Never used in
 * object keys (those are random).
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, FILE_NAME_MAX_LENGTH)
    .trim();
  return cleaned === '' ? FALLBACK_FILE_NAME : cleaned;
}

/** Private media lives in the private bucket; everything else in the public one. */
export function bucketOf(visibility: MediaVisibility): Bucket {
  return visibility === 'private' ? 'private' : 'public';
}

/** Random, input-free key of an original upload: media/<kind>/<assetId>/original.<ext>. */
export function originalKey(kind: MediaKind, assetId: string, extension: string): string {
  return `media/${kind}/${assetId}/original.${extension}`;
}

/**
 * Rendition key, versioned by processing attempt so a retry never overwrites an object a CDN may
 * already have cached.
 */
export function renditionKey(
  kind: MediaKind,
  assetId: string,
  attempt: number,
  label: string,
  format: string,
): string {
  return `media/${kind}/${assetId}/a${attempt}/${label}.${format}`;
}
