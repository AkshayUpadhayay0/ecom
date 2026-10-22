'use client';

import type { PublicVideoDto } from '@urban-ibile/shared';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRenditionUrl } from '@/lib/video/use-rendition-url';
import { useI18n } from '@/lib/i18n/provider';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';

/**
 * Hero background. The poster is server-rendered and preloaded (it is the LCP element); the video
 * mounts after hydration only when allowed. Reduced motion, data saver or a blocked autoplay keep
 * the poster and show a play control. A pause/play control is always present (WCAG 2.2.2).
 */
export function HeroMedia({ video }: { video: PublicVideoDto }) {
  const { t } = useI18n();
  const prefs = useMediaPreferences();
  const element = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [userStarted, setUserStarted] = useState(false);

  const mayAutoplay = !prefs.reducedMotion && !prefs.saveData;

  const picked = useRenditionUrl(video.mp4);
  const src = mayAutoplay || userStarted ? (picked ?? video.previewUrl) : null;

  useEffect(() => {
    const el = element.current;
    if (!el || !src) return;
    el.play().then(
      () => {
        setBlocked(false);
      },
      () => {
        setBlocked(true);
        setPlaying(false);
      },
    );
  }, [src]);

  function toggle(): void {
    const el = element.current;
    if (!src) {
      setUserStarted(true);
      return;
    }
    if (!el) return;
    if (el.paused) {
      el.play().then(
        () => {
          setBlocked(false);
        },
        () => {
          setBlocked(true);
        },
      );
    } else {
      el.pause();
    }
  }

  const label = playing ? t('video.pause') : t('video.play');

  return (
    <>
      <div className="absolute inset-0" style={{ backgroundColor: video.dominantColor ?? 'var(--ui-ink)' }}>
        {video.posterUrl ? (
          <Image src={video.posterUrl} alt="" fill priority fetchPriority="high" sizes="100vw" className="object-cover" />
        ) : null}
        {src ? (
          <video
            ref={element}
            src={src}
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
            onPause={() => {
              setPlaying(false);
            }}
            onError={() => {
              setBlocked(true);
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
              playing && !blocked ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="on-dark absolute bottom-4 right-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-ink text-ivory"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
    </>
  );
}
