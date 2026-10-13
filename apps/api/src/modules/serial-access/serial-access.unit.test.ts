import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';
import { createSerialHasher, normalizeSerial, serialHint } from './serial-hash.js';

describe('parseCsv', () => {
  it('handles CRLF, quoted fields with commas and escaped quotes, and skips blank lines', () => {
    const rows = parseCsv('serial,category\r\n"A,1",GENERAL\r\n\r\n"say ""hi""",EXCLUSIVE\n');
    expect(rows).toEqual([
      { line: 1, cells: ['serial', 'category'] },
      { line: 2, cells: ['A,1', 'GENERAL'] },
      { line: 4, cells: ['say "hi"', 'EXCLUSIVE'] },
    ]);
  });
});

describe('serial helpers', () => {
  it('trims only (exact match otherwise)', () => {
    expect(normalizeSerial('  GN-001  ')).toBe('GN-001');
    expect(normalizeSerial('   ')).toBeUndefined();
    const hasher = createSerialHasher('k'.repeat(32));
    expect(hasher.hash('GN-001')).not.toBe(hasher.hash('gn-001'));
    expect(hasher.hash('GN-001')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('masks hints; short serials reveal nothing', () => {
    expect(serialHint('GN-TEST-4821')).toBe('****4821');
    expect(serialHint('SHORT')).toBe('****');
  });
});
