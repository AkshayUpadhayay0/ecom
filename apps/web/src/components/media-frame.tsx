'use client';

import type { PublicGridMediaDto, PublicImageDto } from '@urban-ibile/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MediaImage } from '@/components/media-image';
import { useI18n } from '@/lib/i18n/provider';
import { isAutoplayBlocked } from '@/lib/video/play-result';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';
import { useVideoSlot } from '@/lib/video/use-video-slot';
import { pausedReasonFor } from '@/lib/video/paused-reason';
import { registerPausedVideo } from '@/lib/video/video-notice';

/** Smallest image variant at least this wide is used as a card poster fallback. */
const CARD_IMAGE_MIN_WIDTH = 640;

export function cardPosterUrl(
  media: PublicGridMediaDto | null,
  image: PublicImageDto | null,
): string | null {
  if (media?.posterUrl) return media.posterUrl;
  const variants = image?.variants ?? [];
  const sized =
    variants.find((v) => (v.width ?? 0) >= CARD_IMAGE_MIN_WIDTH) ?? variants[variants.length - 1];
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

  const id = useId();

  const [failed, setFailed] = useState(false); // the file could not be loaded
  const [blocked, setBlocked] = useState(false); // the browser refused to autoplay it
  const [tapped, setTapped] = useState(false);
  const [playing, setPlaying] = useState(false);

  const autoplayAllowed =
    Boolean(previewUrl) && !prefs.reducedMotion && !prefs.saveData && !failed && !blocked;
  const slotActive = useVideoSlot(frame, { enabled: autoplayAllowed });
  const showVideo = Boolean(previewUrl) && !failed && (slotActive || tapped);
  const needsPlayButton = Boolean(previewUrl) && !autoplayAllowed && !tapped;

  // Tell the page why this card shows a poster, so the small notice can explain it.
  const pausedReason = pausedReasonFor(prefs, { hasVideo: Boolean(previewUrl), tapped, blocked });
  const connectionType = prefs.connectionType;
  useEffect(() => {
    if (!pausedReason) return;
    return registerPausedVideo(id, { reason: pausedReason, detail: connectionType });
  }, [id, pausedReason, connectionType]);

  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      if (!element) return;
      // StrictMode (development) runs cleanup and attach again on the SAME element: the cleanup
      // below removed its source, and React does not set an unchanged src prop again.
      if (previewUrl && !element.getAttribute('src')) element.src = previewUrl;
      let mounted = true;
      element.play().catch((error: unknown) => {
        // Unloaded while starting (StrictMode remount, slot taken away): not a refusal, ignore.
        if (!mounted || !isAutoplayBlocked(error)) return;
        // Autoplay really blocked: stay on the poster and offer the play button.
        setBlocked(true);
        setTapped(false);
      });
      return () => {
        mounted = false;
        unloadVideo(element);
        setPlaying(false);
      };
    },
    [previewUrl],
  );

  return (
    <div
      ref={frame}
      className="relative aspect-[4/5] w-full overflow-hidden"
      style={{ backgroundColor: media?.dominantColor ?? image?.dominantColor ?? 'var(--ui-line)' }}
    >
      {posterUrl ? (
        <MediaImage
          src={posterUrl}
          alt=""
          variants={media?.posterUrl ? undefined : image?.variants}
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
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
            // A tap is a user gesture: the browser allows playback now.
            setFailed(false);
            setBlocked(false);
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
