import { describe, expect, it } from 'vitest';
import { cleanText, stripHtml } from './sanitize-text.js';

describe('stripHtml', () => {
  it.each([
    [
      'plain **markdown** [link](https://example.com)',
      'plain **markdown** [link](https://example.com)',
    ],
    ['a < b & c > d', 'a < b & c > d'],
    ['<b>bold</b> text', 'bold text'],
    ['<script>alert(1)</script>Hi', 'Hi'],
    ['<img src=x onerror=alert(1)>', ''],
    ['&lt;script&gt;alert(1)&lt;/script&gt;ok', 'ok'],
    ['&amp;lt;b&amp;gt;nested', 'nested'],
  ])('%j -> %j', (input, expected) => {
    expect(stripHtml(input)).toBe(expected);
  });

  it('never returns markup that a browser would parse as a tag', () => {
    const output = stripHtml('<<script>script>alert(1)<</script>/script>');
    expect(output).not.toMatch(/<[a-z/!]/i);
  });
});

describe('cleanText', () => {
  it('maps empty / whitespace / tag-only input to null', () => {
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText('<p></p>')).toBeNull();
    expect(cleanText('  Hello ')).toBe('Hello');
  });
});
