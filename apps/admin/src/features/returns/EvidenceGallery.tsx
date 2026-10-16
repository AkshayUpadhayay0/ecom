import type { AdminReturnEvidenceDto } from '@urban-ibile/shared';
import { FileImage } from 'lucide-react';

/** Refetch this long before the earliest signed URL expires. */
const EXPIRY_MARGIN_MS = 30_000;
/** Never poll faster than this (also used when a URL has already expired). */
const MIN_REFRESH_MS = 1_000;

/**
 * Milliseconds until the detail should be refetched to get fresh signed URLs, or false when no
 * evidence URL expires. Used as TanStack Query's refetchInterval.
 */
export function evidenceRefreshDelay(
  evidence: readonly AdminReturnEvidenceDto[] | undefined,
  now: number = Date.now(),
): number | false {
  const expiries = (evidence ?? [])
    .filter((e) => e.url !== null && e.expiresAt !== null)
    .map((e) => new Date(e.expiresAt ?? 0).getTime());
  if (expiries.length === 0) return false;
  return Math.max(MIN_REFRESH_MS, Math.min(...expiries) - EXPIRY_MARGIN_MS - now);
}

/**
 * Private evidence photos through short-lived signed URLs (never public links). A URL that fails
 * to load (expired) triggers a refetch for fresh ones.
 */
export function EvidenceGallery({
  evidence,
  onExpired,
}: {
  evidence: readonly AdminReturnEvidenceDto[];
  onExpired: () => void;
}) {
  if (evidence.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence was attached.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {evidence.map((item, index) => (
        <li key={item.id} className="overflow-hidden rounded-lg border bg-muted/30">
          {item.url === null ? (
            <div className="flex aspect-square flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
              <FileImage className="size-5" aria-hidden="true" />
              Not uploaded yet ({item.status})
            </div>
          ) : item.mimeType.startsWith('image/') ? (
            <a href={item.url} target="_blank" rel="noreferrer noopener">
              <img
                src={item.url}
                alt={`Customer evidence ${index + 1}`}
                className="aspect-square w-full object-cover"
                onError={onExpired}
                referrerPolicy="no-referrer"
              />
            </a>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex aspect-square items-center justify-center p-2 text-sm underline"
            >
              Open file {index + 1}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
