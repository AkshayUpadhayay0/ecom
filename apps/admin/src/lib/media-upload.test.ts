import type { MediaAssetDto, MediaLibraryItemDto } from '@urban-ibile/shared';
import { describe, expect, it } from 'vitest';
import {
  POLL_MAX_MS,
  POLL_MIN_MS,
  assetRefetchInterval,
  checkFile,
  libraryRefetchInterval,
  pollDelayMs,
} from './media-upload';

const MB = 1024 * 1024;
const NOW = Date.parse('2026-10-29T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

function asset(status: string, uploadedAgoMs: number, retired = false): MediaLibraryItemDto {
  return {
    id: `a-${status}-${uploadedAgoMs}`,
    status,
    uploadedAt: ago(uploadedAgoMs),
    createdAt: ago(uploadedAgoMs + 1000),
    retiredAt: retired ? ago(0) : null,
  } as unknown as MediaLibraryItemDto;
}

describe('pollDelayMs: 2 s growing to 10 s', () => {
  it('starts at the minimum, grows with age and stops growing at the maximum', () => {
    expect(pollDelayMs(0)).toBe(POLL_MIN_MS);
    expect(pollDelayMs(-5000)).toBe(POLL_MIN_MS);
    expect(pollDelayMs(16_000)).toBe(4_000);
    expect(pollDelayMs(40_000)).toBe(7_000);
    expect(pollDelayMs(10 * 60_000)).toBe(POLL_MAX_MS);
  });
});

describe('assetRefetchInterval', () => {
  const state = (data?: MediaAssetDto) => ({ state: { data } });
  it('keeps checking a file that is still being processed', () => {
    for (const status of ['pending', 'uploaded', 'processing']) {
      expect(
        assetRefetchInterval(state(asset(status, 4000) as unknown as MediaAssetDto), NOW),
      ).toBe(2_500);
    }
  });
  it('checks again soon while nothing has loaded yet', () => {
    expect(assetRefetchInterval(state(undefined), NOW)).toBe(POLL_MIN_MS);
  });
  it('stops when the file is ready or failed', () => {
    expect(assetRefetchInterval(state(asset('ready', 1000) as unknown as MediaAssetDto), NOW)).toBe(
      false,
    );
    expect(
      assetRefetchInterval(state(asset('failed', 1000) as unknown as MediaAssetDto), NOW),
    ).toBe(false);
  });
});

describe('libraryRefetchInterval', () => {
  const list = (...items: MediaLibraryItemDto[]) => ({ state: { data: { data: items } } });
  it('does not poll a library with nothing in progress', () => {
    expect(libraryRefetchInterval(list(asset('ready', 1000), asset('failed', 1000)), NOW)).toBe(
      false,
    );
    expect(libraryRefetchInterval({ state: { data: undefined } }, NOW)).toBe(false);
  });
  it('polls while any file is working, quickly for a file just uploaded', () => {
    expect(libraryRefetchInterval(list(asset('ready', 1000), asset('processing', 0)), NOW)).toBe(
      POLL_MIN_MS,
    );
    expect(
      libraryRefetchInterval(list(asset('processing', 600_000), asset('uploaded', 8_000)), NOW),
    ).toBe(3_000); // the newest decides
  });
  it('ignores retired files', () => {
    expect(libraryRefetchInterval(list(asset('processing', 1000, true)), NOW)).toBe(false);
  });
});

describe('checkFile', () => {
  const limits = { maxVideoBytes: 500 * MB, maxImageBytes: 20 * MB, maxVideoSeconds: 120 };
  const file = (type: string, size: number, name = 'clip') => ({ name, type, size });

  it('accepts a normal video without warnings', () => {
    expect(checkFile(file('video/mp4', 40 * MB), limits, 30)).toEqual({
      ok: true,
      problem: null,
      warnings: [],
    });
  });
  it('refuses a file type we do not accept, in plain words', () => {
    const result = checkFile(file('application/pdf', MB, 'plan.pdf'), limits);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('plan.pdf is not a type we accept');
    expect(result.problem).toContain('MP4, MOV or WebM');
  });
  it('refuses a too-large video with the real limit and a recommendation', () => {
    const result = checkFile(file('video/mp4', 612 * MB), limits);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('612 MB');
    expect(result.problem).toContain('500 MB');
    expect(result.problem).toContain('1080p');
  });
  it('uses the limit set in Settings, not a fixed number', () => {
    expect(checkFile(file('video/mp4', 60 * MB), { ...limits, maxVideoBytes: 50 * MB }).ok).toBe(
      false,
    );
    expect(checkFile(file('image/png', 30 * MB), limits).problem).toContain('20 MB');
  });
  it('refuses an empty file', () => {
    expect(checkFile(file('video/mp4', 0), limits).ok).toBe(false);
  });
  it('lets a big or long video through but says so', () => {
    const big = checkFile(file('video/mp4', 200 * MB), limits, 20);
    expect(big.ok).toBe(true);
    expect(big.warnings.join(' ')).toContain('bigger than needed');
    const long = checkFile(file('video/mp4', 40 * MB), limits, 90);
    expect(long.ok).toBe(true);
    expect(long.warnings.join(' ')).toContain('90 seconds');
  });
  it('refuses a video longer than the hard cap, with the real number', () => {
    const result = checkFile(file('video/mp4', 40 * MB), limits, 150);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('2:30');
    expect(result.problem).toContain('2:00');
    expect(checkFile(file('video/mp4', 40 * MB), { ...limits, maxVideoSeconds: 300 }, 150).ok).toBe(
      true,
    );
  });
});
