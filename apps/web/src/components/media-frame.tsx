'use client';

import type { PublicGridMediaDto, PublicImageDto } from '@urban-ibile/shared';
import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/provider';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';
import { useVideoSlot } from '@/lib/video/use-video-slot';

/** Smallest image variant at least this wide is used as a card poster fallback. */
const CARD_IMAGE_MIN_WIDTH = 640;

export function cardPosterUrl(media: PublicGridMediaDto | null, image: PublicImageDto | null): string | null {
  if (media?.posterUrl) return media.posterUrl;
  const variants = image?.variants ?? [];
  const sized = variants.find((v) => (v.width ?? 0) >= CARD_IMAGE_MIN_WIDTH) ?? variants[variants.length - 1];
  return sized?.url ?? null;
}

interface Props {
  media: PublicGridMediaDto | null;
  image: PublicImageDto | null;
  /** Decorative: the card's link carries the product name. */
  priority?: boolean;
  sizes: string;
}

function unloadVideo(element: HTMLVideoElement): void {
  element.pause();
  element.removeAttribute('src');
  element.load();
}

/**
 * Card media: dominant-colour box with the poster first. The preview loop is mounted only while
 * the card is near the viewport AND holds one of the page's play slots; it is unloaded when it
 * leaves. Reduced motion, data saver and autoplay rejection fall back to the poster with a play
 * button (a user tap is allowed to start the loop).
 */
export function MediaFrame({ media, image, priority = false, sizes }: Props) {
  const { t } = useI18n();
  const prefs = useMediaPreferences();
  const frame = useRef<HTMLDivElement>(null);
  const previewUrl = media?.previewUrl ?? null;
  const posterUrl = cardPosterUrl(media, image);

  const [failed, setFailed] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [playing, setPlaying] = useState(false);

  const autoplayAllowed = Boolean(previewUrl) && !prefs.reducedMotion && !prefs.saveData && !failed;
  const slotActive = useVideoSlot(frame, { enabled: autoplayAllowed });
  const showVideo = Boolean(previewUrl) && !failed && (slotActive || tapped);
  const needsPlayButton = Boolean(previewUrl) && !autoplayAllowed && !tapped;

  const attach = useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    element.play().catch(() => {
      // Autoplay blocked: stay on the poster and offer the play button again.
      setFailed(true);
      setTapped(false);
    });
    return () => {
      unloadVideo(element);
      setPlaying(false);
    };
  }, []);

  return (
    <div
      ref={frame}
      className="relative aspect-[4/5] w-full overflow-hidden"
      style={{ backgroundColor: media?.dominantColor ?? image?.dominantColor ?? 'var(--ui-line)' }}
    >
      {posterUrl ? (
        <Image src={posterUrl} alt="" fill sizes={sizes} priority={priority} className="object-cover" />
      ) : null}
      {showVideo && previewUrl ? (
        <video
          ref={attach}
          src={previewUrl}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => {
            setPlaying(true);
          }}
          onError={() => {
            setFailed(true);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            playing ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
      {needsPlayButton ? (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setTapped(true);
          }}
          aria-label={t('video.play')}
          className="absolute bottom-3 left-3 z-20 grid h-11 w-11 place-items-center rounded-full bg-ink text-ivory"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
