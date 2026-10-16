import type { MediaAssetDto } from '@urban-ibile/shared';
import { Film, ImageIcon, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Smallest public image rendition (or the poster for videos), else an icon. */
export function thumbnailUrl(asset: MediaAssetDto): string | null {
  if (asset.visibility !== 'public') return null;
  const images = asset.renditions
    .filter(
      (r) => r.url !== null && (r.format === 'webp' || r.format === 'jpg' || r.format === 'jpeg'),
    )
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return images[0]?.url ?? (asset.kind === 'image' ? asset.publicUrl : null);
}

export function MediaThumb({ asset, className }: { asset: MediaAssetDto; className?: string }) {
  const url = thumbnailUrl(asset);
  const Icon = asset.visibility === 'private' ? Lock : asset.kind === 'video' ? Film : ImageIcon;
  return (
    <div
      className={cn(
        'flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted',
        className,
      )}
      style={asset.dominantColor ? { backgroundColor: asset.dominantColor } : undefined}
    >
      {url ? (
        <img
          src={url}
          alt={asset.originalFilename ?? `${asset.kind} ${asset.id.slice(0, 8)}`}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
