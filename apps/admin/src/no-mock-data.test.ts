import { describe, expect, it } from 'vitest';

/*
 * Guard: the admin panel shows real API data only. Mock sources and test fixtures may exist
 * for tests, but no page/component may import them (also enforced by ESLint).
 */
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const isTestFile = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith('./test/');
const MOCK_IMPORT = /from\s+['"][^'"]*(\.mock|\.fixtures|@\/test\/|\/test\/)[^'"]*['"]/;

describe('no mock data in the admin panel', () => {
  const appFiles = Object.entries(sources).filter(([path]) => !isTestFile(path));

  it('scans the app sources', () => {
    expect(appFiles.length).toBeGreaterThan(20);
  });

  it('no page or component imports mock data or test fixtures', () => {
    const offenders = appFiles.filter(([, code]) => MOCK_IMPORT.test(code)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('no mock data source files remain outside tests', () => {
    const mockFiles = appFiles.filter(([path]) => /\.mock\.tsx?$/.test(path)).map(([path]) => path);
    expect(mockFiles).toEqual([]);
    const flagged = appFiles
      .filter(([, code]) => /IS_MOCK_DATA|SAMPLE_ORDERS/.test(code))
      .map(([path]) => path);
    expect(flagged).toEqual([]);
  });
});
