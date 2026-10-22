import { describe, expect, it } from 'vitest';
import { pickRendition } from './renditions';

const sources = [
  { label: '1080p', url: 'c', width: 1920, height: 1080 },
  { label: '480p', url: 'a', width: 854, height: 480 },
  { label: '720p', url: 'b', width: 1280, height: 720 },
];

describe('pickRendition', () => {
  it('takes the smallest on phones', () => {
    expect(pickRendition(sources, { viewportWidth: 390, constrained: false })?.label).toBe('480p');
  });
  it('takes 720p on tablets and laptops', () => {
    expect(pickRendition(sources, { viewportWidth: 1280, constrained: false })?.label).toBe('720p');
  });
  it('takes the largest on big screens with a good connection', () => {
    expect(pickRendition(sources, { viewportWidth: 1920, constrained: false })?.label).toBe(
      '1080p',
    );
  });
  it('takes the smallest on a constrained connection whatever the screen', () => {
    expect(pickRendition(sources, { viewportWidth: 1920, constrained: true })?.label).toBe('480p');
  });
  it('compares portrait files by their short side', () => {
    const portrait = [
      { label: '720p', url: 'p', width: 720, height: 1280 },
      { label: '480p', url: 'q', width: 480, height: 854 },
    ];
    expect(pickRendition(portrait, { viewportWidth: 390, constrained: false })?.label).toBe('480p');
  });
  it('copes with a single rendition and none', () => {
    expect(
      pickRendition(sources.slice(1, 2), { viewportWidth: 1920, constrained: false })?.label,
    ).toBe('480p');
    expect(pickRendition([], { viewportWidth: 1920, constrained: false })).toBeUndefined();
  });
});
