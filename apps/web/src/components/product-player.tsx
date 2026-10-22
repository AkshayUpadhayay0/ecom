'use client';

import type { PublicVideoDto } from '@urban-ibile/shared';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';
import { useRenditionUrl } from '@/lib/video/use-rendition-url';

const FALLBACK_ASPECT = '4 / 5';

/**
 * Product video with native controls. No autoplay (the shopper starts it), metadata only is
 * preloaded (nothing at all on a constrained connection), and the rendition follows the viewport
 * and connection; the shopper can pick another quality when several exist.
 */
export function ProductPlayer({ video, name }: { video: PublicVideoDto; name: string }) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string | null>(null);
  const { saveData } = useMediaPreferences();
  const automatic = useRenditionUrl(video.mp4);

  const aspect = video.width && video.height ? `${video.width} / ${video.height}` : FALLBACK_ASPECT;
  const src = chosen ?? automatic ?? video.mp4[0]?.url ?? video.previewUrl ?? undefined;

  return (
    <div>
      <div
        className="w-full overflow-hidden"
        style={{ aspectRatio: aspect, backgroundColor: video.dominantColor ?? 'var(--ui-ink)' }}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no caption source exists; product videos are visual (muted loops and clips) */}
        <video
          key={src}
          controls
          playsInline
          preload={saveData ? 'none' : 'metadata'}
          poster={video.posterUrl ?? undefined}
          aria-label={`${t('product.video_label')}: ${name}`}
          className="h-full w-full object-contain"
        >
          {src ? <source src={src} type="video/mp4" /> : null}
        </video>
      </div>
      {video.mp4.length > 1 ? (
        <div role="group" aria-label={t('product.video_label')} className="mt-2 flex gap-2 text-sm">
          {video.mp4.map((rendition) => (
            <button
              key={rendition.url}
              type="button"
              aria-pressed={rendition.url === src}
              onClick={() => {
                setChosen(rendition.url);
              }}
              className={`min-h-11 border border-ink px-3 ${rendition.url === src ? 'bg-ink text-ivory' : ''}`}
            >
              {rendition.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
