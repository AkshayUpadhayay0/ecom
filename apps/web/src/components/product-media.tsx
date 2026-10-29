'use client';

import type { PublicImageDto, PublicVideoDto } from '@urban-ibile/shared';
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { MediaImage } from '@/components/media-image';
import { isMediaUrlAllowed } from '@/config/media-env';
import { useI18n } from '@/lib/i18n/provider';
import { pausedReasonFor } from '@/lib/video/paused-reason';
import { isAutoplayBlocked } from '@/lib/video/play-result';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';
import { useRenditionUrl } from '@/lib/video/use-rendition-url';
import { useVideoSlot } from '@/lib/video/use-video-slot';
import { registerPausedVideo } from '@/lib/video/video-notice';

/** Shape used when neither the video nor a photo reports its size (the old product-page ratio). */
const FALLBACK_ASPECT = 4 / 5;
const IMAGE_SIZES = '(min-width: 1024px) 28rem, 100vw';
const THUMB_SIZES = '4rem';

interface Photo {
  image: PublicImageDto;
  /** Largest variant: the main view. */
  url: string;
}

type Item = { kind: 'video' } | { kind: 'photo'; photo: Photo };

function aspectOf(width: number | null, height: number | null): number | null {
  return width && height ? width / height : null;
}

function unloadVideo(element: HTMLVideoElement): void {
  element.pause();
  element.removeAttribute('src');
  element.load();
}

function PlayGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {muted ? (
        <path d="M16 9l5 6m0-6l-5 6" stroke="currentColor" strokeWidth="2" fill="none" />
      ) : (
        <path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" strokeWidth="2" fill="none" />
      )}
    </svg>
  );
}

/**
 * The product video inside the stage. Same rules as the shop cards: poster first, muted looping
 * autoplay while the stage holds one of the page's play slots, a play button only when the browser
 * really refuses autoplay (NotAllowedError) or the visitor's settings say no (reduced motion, Data
 * Saver, slow link, each with a label). Controls are a minimal overlay: tap to pause, mute button.
 */
function VideoStage({
  video,
  name,
  chosen,
}: {
  video: PublicVideoDto;
  name: string;
  chosen: string | null;
}) {
  const { t } = useI18n();
  const prefs = useMediaPreferences();
  const automatic = useRenditionUrl(video.mp4);
  const frame = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLVideoElement | null>(null);
  const id = useId();

  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const src = chosen ?? automatic ?? video.mp4[0]?.url ?? video.previewUrl ?? null;
  const autoplayAllowed =
    src !== null && !prefs.reducedMotion && !prefs.saveData && !failed && !blocked;
  const slotActive = useVideoSlot(frame, { enabled: autoplayAllowed });
  const showVideo = src !== null && !failed && (slotActive || tapped);

  const pausedReason = pausedReasonFor(prefs, {
    hasVideo: src !== null,
    tapped,
    blocked,
  });
  const connectionType = prefs.connectionType;
  useEffect(() => {
    if (!pausedReason) return;
    return registerPausedVideo(id, { reason: pausedReason, detail: connectionType });
  }, [id, pausedReason, connectionType]);

  const attach = useCallback(
    (video_: HTMLVideoElement | null) => {
      element.current = video_;
      if (!video_) return;
      // StrictMode (development) runs cleanup and attach again on the SAME element: the cleanup
      // removed its source and React does not set an unchanged src prop again.
      if (src && !video_.getAttribute('src')) video_.src = src;
      let mounted = true;
      video_.play().catch((error: unknown) => {
        // Unloaded while starting (remount, slot taken away): not a refusal.
        if (!mounted || !isAutoplayBlocked(error)) return;
        setBlocked(true);
        setTapped(false);
      });
      return () => {
        mounted = false;
        unloadVideo(video_);
        setPlaying(false);
      };
    },
    [src],
  );

  useEffect(() => {
    if (element.current) element.current.muted = muted;
  }, [muted, showVideo]);

  function toggle(): void {
    const current = element.current;
    if (!showVideo || !current) {
      // A tap is a user gesture: the browser allows playback now.
      setFailed(false);
      setBlocked(false);
      setTapped(true);
      return;
    }
    if (current.paused) void current.play().catch(() => undefined);
    else current.pause();
  }

  return (
    <div ref={frame} className="absolute inset-0">
      {video.posterUrl ? (
        <MediaImage
          src={video.posterUrl}
          alt=""
          sizes={IMAGE_SIZES}
          priority
          className="object-contain"
        />
      ) : null}
      {showVideo && src ? (
        <video
          key={src}
          ref={attach}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-label={`${t('product.video_label')}: ${name}`}
          onPlaying={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onError={() => {
            setFailed(true);
          }}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            playing ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
      {/* Tap anywhere to pause or play; also the one play button when playback did not start. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('video.pause') : t('video.play')}
        className="absolute inset-0 z-10 grid place-items-center"
      >
        {!playing ? (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-ivory">
            <PlayGlyph size={20} />
          </span>
        ) : null}
      </button>
      {showVideo ? (
        <button
          type="button"
          onClick={() => {
            setMuted((value) => !value);
          }}
          aria-pressed={!muted}
          aria-label={muted ? t('video.unmute') : t('video.mute')}
          className="absolute right-3 bottom-3 z-20 grid h-11 w-11 place-items-center rounded-full bg-ink text-ivory"
        >
          <SpeakerGlyph muted={muted} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Product page media: the main view (the video, or one photo) with a small thumbnail strip, the
 * video first. Choosing a thumbnail switches the main view. Photos whose URL is not allowed are
 * left out (never an empty box); with only one item there is no strip.
 */
export function ProductMedia({
  video,
  images,
  name,
}: {
  video: PublicVideoDto | null;
  images: readonly PublicImageDto[];
  name: string;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);

  const photos: Photo[] = images.flatMap((image) => {
    const largest = image.variants[image.variants.length - 1];
    return largest && isMediaUrlAllowed(largest.url) ? [{ image, url: largest.url }] : [];
  });
  const items: Item[] = [
    ...(video ? [{ kind: 'video' } as const] : []),
    ...photos.map((photo) => ({ kind: 'photo', photo }) as const),
  ];
  const active = items[Math.min(selected, items.length - 1)];

  if (!active) {
    // Nothing to show at all: a quiet placeholder (never a dark box).
    return <div className="aspect-[4/5] bg-line" role="img" aria-label={name} />;
  }

  const first = items[0];
  const aspect =
    (video
      ? aspectOf(video.width, video.height)
      : first?.kind === 'photo'
        ? aspectOf(first.photo.image.width, first.photo.image.height)
        : null) ?? FALLBACK_ASPECT;
  const background =
    active.kind === 'video'
      ? (video?.dominantColor ?? 'var(--ui-line)')
      : (active.photo.image.dominantColor ?? 'var(--ui-line)');

  return (
    <div>
      <div
        className="product-media-stage"
        style={{ '--media-aspect': aspect, backgroundColor: background } as CSSProperties}
      >
        {active.kind === 'video' && video ? (
          <VideoStage video={video} name={name} chosen={chosen} />
        ) : active.kind === 'photo' ? (
          <MediaImage
            src={active.photo.url}
            variants={active.photo.image.variants}
            alt={`${name} (${items.indexOf(active) + 1 - (video ? 1 : 0)})`}
            sizes={IMAGE_SIZES}
            priority={!video}
            className="object-contain"
          />
        ) : null}
      </div>

      {items.length > 1 ? (
        <div
          role="group"
          aria-label={t('product.media_label')}
          className="mt-3 flex flex-wrap gap-2"
        >
          {items.map((item, index) => {
            const isActive = item === active;
            const label =
              item.kind === 'video'
                ? t('product.video_label')
                : t('product.photo_n', { n: index + 1 - (video ? 1 : 0), total: photos.length });
            const thumbUrl =
              item.kind === 'video'
                ? video?.posterUrl
                : (item.photo.image.variants[0]?.url ?? item.photo.url);
            return (
              <button
                key={item.kind === 'video' ? 'video' : item.photo.url}
                type="button"
                aria-pressed={isActive}
                aria-label={label}
                onClick={() => {
                  setSelected(index);
                }}
                className={`relative h-16 w-16 overflow-hidden border-2 ${
                  isActive ? 'border-ink' : 'border-transparent'
                }`}
                style={{
                  backgroundColor:
                    (item.kind === 'video'
                      ? video?.dominantColor
                      : item.photo.image.dominantColor) ?? 'var(--ui-line)',
                }}
              >
                {thumbUrl ? (
                  <MediaImage src={thumbUrl} alt="" sizes={THUMB_SIZES} className="object-cover" />
                ) : null}
                {item.kind === 'video' ? (
                  <span className="absolute right-1 bottom-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-ivory">
                    <PlayGlyph size={10} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {video && video.mp4.length > 1 && active.kind === 'video' ? (
        <details className="mt-2 text-xs text-ink-muted">
          <summary className="inline-block min-h-6 cursor-pointer">{t('product.quality')}</summary>
          <div role="group" aria-label={t('product.quality')} className="mt-1 flex gap-1">
            <button
              type="button"
              aria-pressed={chosen === null}
              onClick={() => {
                setChosen(null);
              }}
              className={`min-h-8 border border-ink px-2 ${chosen === null ? 'bg-ink text-ivory' : ''}`}
            >
              {t('product.quality_auto')}
            </button>
            {video.mp4.map((rendition) => (
              <button
                key={rendition.url}
                type="button"
                aria-pressed={chosen === rendition.url}
                onClick={() => {
                  setChosen(rendition.url);
                }}
                className={`min-h-8 border border-ink px-2 ${chosen === rendition.url ? 'bg-ink text-ivory' : ''}`}
              >
                {rendition.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
