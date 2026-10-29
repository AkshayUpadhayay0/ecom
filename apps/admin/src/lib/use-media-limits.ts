import { useQuery } from '@tanstack/react-query';
import { configApi } from '@/lib/api/config-api';
import { DEFAULT_LIMITS, type MediaLimits } from '@/lib/media-upload';

const FIVE_MINUTES_MS = 5 * 60_000;

function bytesOf(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The upload size limits the server enforces (settings media.max_video_bytes / media.max_image_bytes),
 * so the form can refuse a too-large file at once and say the real number. Falls back to the
 * documented defaults while loading or if settings cannot be read.
 */
export function useMediaLimits(): MediaLimits {
  const settings = useQuery({
    queryKey: ['config', 'media-limits'],
    queryFn: () => configApi.settings(),
    staleTime: FIVE_MINUTES_MS,
    retry: false,
  });
  const find = (key: string): unknown => {
    const row = settings.data?.find((s) => s.key === key);
    return row?.value ?? row?.defaultValue;
  };
  return {
    maxVideoBytes: bytesOf(find('media.max_video_bytes'), DEFAULT_LIMITS.maxVideoBytes),
    maxImageBytes: bytesOf(find('media.max_image_bytes'), DEFAULT_LIMITS.maxImageBytes),
  };
}
