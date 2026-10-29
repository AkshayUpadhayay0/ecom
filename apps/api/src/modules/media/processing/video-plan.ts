import type { VideoProbe } from './ffmpeg-runner.js';

/** Encoding knobs from env (FFMPEG_X264_PRESET / FFMPEG_X264_CRF). */
export interface EncodeOptions {
  preset: string;
  crf: number;
  /** x264 threads per encode (set so parallel encodes share the CPUs); omitted = ffmpeg decides. */
  threads?: number;
}

const threadArgs = (options: EncodeOptions): string[] =>
  options.threads ? ['-threads', String(options.threads)] : [];

export interface RenditionTarget {
  /** e.g. "720p": the SHORT side of the frame (portrait product videos are common). */
  label: string;
  shortSide: number;
}

/** Poster frame and preview are scaled to these short sides (team design defaults). */
export const POSTER_SHORT_SIDE = 720;
export const PREVIEW_SHORT_SIDE = 480;
const AUDIO_BITRATE = '128k';
const POSTER_JPEG_QUALITY = '3';
const POSTER_MAX_OFFSET_SECONDS = 1;
const MS_PER_SECOND = 1000;

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);

/**
 * Rendition sizes for a source: every configured size up to the source's short side (never
 * upscaled). A source smaller than the smallest size gets one rendition at its own size.
 */
export function planRenditions(probe: VideoProbe, sizes: readonly number[]): RenditionTarget[] {
  const sourceShort = Math.min(probe.width, probe.height);
  const fitting = sizes.filter((size) => size <= sourceShort);
  const targets = fitting.length > 0 ? fitting : [even(sourceShort)];
  return targets.map((shortSide) => ({ label: `${shortSide}p`, shortSide }));
}

/** ffmpeg scale filter that sets the short side and keeps the aspect ratio (even sizes). */
export function scaleFilter(probe: VideoProbe, shortSide: number): string {
  return probe.width >= probe.height ? `scale=-2:${shortSide}` : `scale=${shortSide}:-2`;
}

/** MP4 H.264/AAC rendition, web-optimised (moov atom first). */
export function renditionArgs(
  input: string,
  output: string,
  probe: VideoProbe,
  target: RenditionTarget,
  options: EncodeOptions,
): string[] {
  return [
    '-y',
    '-i',
    input,
    '-vf',
    scaleFilter(probe, target.shortSide),
    ...threadArgs(options),
    '-c:v',
    'libx264',
    '-preset',
    options.preset,
    '-crf',
    String(options.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', AUDIO_BITRATE] : ['-an']),
    output,
  ];
}

/** One JPEG frame, taken early in the clip. */
export function posterArgs(input: string, output: string, probe: VideoProbe): string[] {
  const offsetSeconds =
    probe.durationMs === null
      ? 0
      : Math.min(POSTER_MAX_OFFSET_SECONDS, probe.durationMs / MS_PER_SECOND / 2);
  return [
    '-y',
    '-ss',
    offsetSeconds.toFixed(2),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    scaleFilter(probe, Math.min(POSTER_SHORT_SIDE, Math.min(probe.width, probe.height))),
    '-q:v',
    POSTER_JPEG_QUALITY,
    output,
  ];
}

/** Short, muted, small loop for product grids. */
export function previewArgs(
  input: string,
  output: string,
  probe: VideoProbe,
  seconds: number,
  options: EncodeOptions,
): string[] {
  return [
    '-y',
    '-i',
    input,
    '-t',
    String(seconds),
    '-an',
    '-vf',
    scaleFilter(probe, Math.min(PREVIEW_SHORT_SIDE, Math.min(probe.width, probe.height))),
    ...threadArgs(options),
    '-c:v',
    'libx264',
    '-preset',
    options.preset,
    '-crf',
    String(options.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ];
}
