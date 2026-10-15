import { describe, expect, it } from 'vitest';
import { fakeMp4, tinyJpeg, tinyPng } from '../../../test/media-fixtures.js';
import { matchesMagicBytes, originalKey, renditionKey, sanitizeFileName } from './media-files.js';
import { retryDelaySeconds } from './processing/media-processor.js';
import { planRenditions, scaleFilter } from './processing/video-plan.js';

describe('matchesMagicBytes', () => {
  it('recognises real file signatures and rejects disguised files', async () => {
    const png = await tinyPng(8, 8);
    const jpeg = await tinyJpeg(8, 8);
    expect(matchesMagicBytes('image/png', png)).toBe(true);
    expect(matchesMagicBytes('image/jpeg', jpeg)).toBe(true);
    expect(matchesMagicBytes('image/png', jpeg)).toBe(false);
    expect(matchesMagicBytes('video/mp4', fakeMp4())).toBe(true);
    expect(matchesMagicBytes('video/mp4', png)).toBe(false);
    expect(matchesMagicBytes('video/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe(true);
    const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
    expect(matchesMagicBytes('image/webp', webp)).toBe(true);
    const html = Buffer.from('<html><script>alert(1)</script>', 'latin1');
    expect(matchesMagicBytes('image/jpeg', html)).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('drops directories, control characters and odd symbols', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\Agbada Look #1.mp4')).toBe('Agbada Look _1.mp4');
    expect(sanitizeFileName('bad\u0000name\u202e.png')).toBe('badname.png');
    expect(sanitizeFileName('...')).toBe('upload');
    expect(sanitizeFileName('x'.repeat(300)).length).toBe(120);
  });
});

describe('object keys', () => {
  it('are built from ids only (no user input) and versioned per attempt', () => {
    const id = '7d0f2a4e-0000-4000-8000-000000000001';
    expect(originalKey('video', id, 'mp4')).toBe(`media/video/${id}/original.mp4`);
    expect(renditionKey('video', id, 2, '720p', 'mp4')).toBe(`media/video/${id}/a2/720p.mp4`);
  });
});

describe('planRenditions', () => {
  const landscape = { durationMs: 1000, width: 1920, height: 1080, hasAudio: true };
  it('never upscales and uses the short side (portrait videos too)', () => {
    expect(planRenditions(landscape, [480, 720, 1080]).map((t) => t.label)).toEqual([
      '480p',
      '720p',
      '1080p',
    ]);
    const portrait720 = { ...landscape, width: 720, height: 1280 };
    expect(planRenditions(portrait720, [480, 720, 1080]).map((t) => t.label)).toEqual([
      '480p',
      '720p',
    ]);
    expect(scaleFilter(portrait720, 480)).toBe('scale=480:-2');
    expect(scaleFilter(landscape, 480)).toBe('scale=-2:480');
  });

  it('gives a tiny source one rendition at its own (even) size', () => {
    const tiny = { durationMs: 1000, width: 427, height: 241, hasAudio: false };
    expect(planRenditions(tiny, [480, 720])).toEqual([{ label: '240p', shortSide: 240 }]);
  });
});

describe('retryDelaySeconds', () => {
  it('doubles the base delay per attempt', () => {
    expect([1, 2, 3].map((attempt) => retryDelaySeconds(60, attempt))).toEqual([60, 120, 240]);
  });
});
