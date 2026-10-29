'use client';

import { useI18n } from '@/lib/i18n/provider';
import { usePausedNotice } from '@/lib/video/video-notice';

/**
 * A small label that explains why videos are showing posters (reduced motion, Data Saver, a slow
 * connection, or autoplay refused by the browser). Shown only while some video is paused for that
 * reason.
 */
export function VideoNotice() {
  const { t } = useI18n();
  const notice = usePausedNotice();
  if (!notice) return null;
  const message =
    notice.reason === 'slow'
      ? t('video.paused.slow', { type: notice.detail ?? '' })
      : t(`video.paused.${notice.reason}`);
  return (
    <p
      role="status"
      data-testid="video-notice"
      className="fixed bottom-3 left-3 z-30 max-w-[calc(100%-1.5rem)] bg-ink px-3 py-2 text-sm text-ivory"
    >
      {message} {t('video.paused.hint')}
    </p>
  );
}
