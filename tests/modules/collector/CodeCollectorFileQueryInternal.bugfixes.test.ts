import { describe, expect, it } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';
import { getFilesByPatternImpl } from '@modules/collector/CodeCollectorFileQueryInternal';
import type { CodeFile } from '@internal-types/index';

function createFile(url: string): CodeFile {
  return { url, content: 'x', size: 1, type: 'external' };
}

describe('getFilesByPatternImpl pattern validation', () => {
  it('reports an invalid pattern instead of leaking a raw SyntaxError', () => {
    const cache = new Map<string, CodeFile>([
      [buildTestUrl('a', { path: '/a.js' }), createFile(buildTestUrl('a', { path: '/a.js' }))],
    ]);

    expect(() => getFilesByPatternImpl(cache, '[', 10, 1024)).toThrow(
      /Invalid regular expression pattern/,
    );
  });

  it('still matches valid patterns', () => {
    const urls = [
      buildTestUrl('app', { path: '/app.js' }),
      buildTestUrl('vendor', { path: '/vendor.js' }),
    ];
    const cache = new Map<string, CodeFile>(urls.map((url) => [url, createFile(url)]));

    const result = getFilesByPatternImpl(cache, 'app\\.js$', 10, 1024);

    expect(result.matched).toBe(1);
    expect(result.files[0]?.url).toBe(buildTestUrl('app', { path: '/app.js' }));
  });
});
