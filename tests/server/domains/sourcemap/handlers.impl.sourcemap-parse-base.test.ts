import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcemapToolHandlersParseBase } from '../../../../src/server/domains/sourcemap/handlers.impl.sourcemap-parse-base';

class TestParseBase extends SourcemapToolHandlersParseBase {
  public async testParseSourceMap(u: string, s?: string) {
    return this.parseSourceMap(u, s);
  }
  public async testLoadSourceMap(u: string, s?: string) {
    return this.loadSourceMap(u, s);
  }
  public testNormalizeSourceMap(v: unknown) {
    return this.normalizeSourceMap(v);
  }
  public testDecodeMappings(m: string) {
    return this.decodeMappings(m);
  }
  public testDecodeVlqSegment(s: string) {
    return this.decodeVlqSegment(s);
  }
  public testFromVlqSigned(v: number) {
    return this.fromVlqSigned(v);
  }
  public async testFetchSourceMapText(u: string) {
    return this.fetchSourceMapText(u);
  }
  public testValidateFetchUrl(u: string) {
    return this.validateFetchUrl(u);
  }
  public testDecodeDataUriJson(u: string) {
    return this.decodeDataUriJson(u);
  }
  public testResolveSourceMapUrl(su: string, scu: string) {
    return this.resolveSourceMapUrl(su, scu);
  }
  public testExtractSourceMappingUrlFromScript(s: string) {
    return this.extractSourceMappingUrlFromScript(s);
  }
  public testHasProtocol(v: string) {
    return this.hasProtocol(v);
  }
  public testAsRecord(v: unknown) {
    return this.asRecord(v);
  }
  public testAsString(v: unknown) {
    return this.asString(v);
  }
}

const mockEvaluateWithTimeout = vi.fn();
vi.mock('../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: (...args: any[]) => mockEvaluateWithTimeout(...args),
}));

describe('SourcemapToolHandlersParseBase', () => {
  let handlers: TestParseBase;
  let mockcollector: any;
  let mockPage: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = {};
    mockcollector = { getActivePage: vi.fn().mockResolvedValue(mockPage) };
    handlers = new TestParseBase(mockcollector as any);
  });

  describe('extractSourceMappingUrlFromScript', () => {
    it('extracts mapped url from comment', async () => {
      expect(
        handlers.testExtractSourceMappingUrlFromScript(
          'var x = 1;\n//# sourceMappingURL=foo.js.map',
        ),
      ).toBe('foo.js.map');
      expect(
        handlers.testExtractSourceMappingUrlFromScript(
          'var x = 1;\n/*# sourceMappingURL=bar.js.map */',
        ),
      ).toBe('bar.js.map');
      expect(handlers.testExtractSourceMappingUrlFromScript('var x = 1;')).toBe(null);
    });
  });

  describe('resolveSourceMapUrl', () => {
    it('resolves bare text', async () => {
      expect(handlers.testResolveSourceMapUrl(' foo ', 'http://script.com/path')).toBe(
        'http://script.com/foo',
      );
    });
    it('handles empty', async () => {
      expect(handlers.testResolveSourceMapUrl(' ', 'scrl')).toBe('');
    });
    it('returns data uri unaltered', async () => {
      expect(handlers.testResolveSourceMapUrl('data:123', 'scrl')).toBe('data:123');
    });
    it('returns full url unaltered', async () => {
      expect(handlers.testResolveSourceMapUrl('http://foo', 'scrl')).toBe('http://foo');
    });
    it('handles missing scriptUrl', async () => {
      expect(handlers.testResolveSourceMapUrl('foo', '')).toBe('foo');
    });
    it('falls back to trimmed if native URL fails', async () => {
      expect(handlers.testResolveSourceMapUrl('foo', 'invalid-script-url')).toBe('foo');
    });
  });

  describe('decodeDataUriJson', () => {
    it('decodes base64', async () => {
      const b64 = Buffer.from('{"ok":1}').toString('base64');
      expect(handlers.testDecodeDataUriJson(`data:application/json;base64,${b64}`)).toBe(
        '{"ok":1}',
      );
    });
    it('decodes uri encoded', async () => {
      expect(handlers.testDecodeDataUriJson(`data:application/json,%7B%22ok%22%3A1%7D`)).toBe(
        '{"ok":1}',
      );
    });
    it('throws on missing comma', async () => {
      expect(() => handlers.testDecodeDataUriJson('data')).toThrow('Invalid data URI');
    });
  });

  describe('validateFetchUrl', () => {
    it('allows valid URLs', async () => {
      expect(() => handlers.testValidateFetchUrl('http://example.com/')).not.toThrow();
      expect(() => handlers.testValidateFetchUrl('https://example.com/')).not.toThrow();
    });
    it('blocks unsupported protocols', async () => {
      expect(() => handlers.testValidateFetchUrl('ftp://example.com/')).toThrow(
        'unsupported protocol',
      );
    });
    it('blocks invalid URLs', async () => {
      expect(() => handlers.testValidateFetchUrl('not a url')).toThrow('Invalid URL');
    });
    it('blocks SSRF targets', async () => {
      const targets = [
        'http://localhost',
        'http://metadata.google.internal',
        'http://metadata',
        'http://127.0.0.1',
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://192.168.1.1',
        'http://0.0.0.0',
        'http://169.254.169.254',
        'http://[::1]',
        'http://[fe80::1]',
        'http://[fc00::1]',
        'http://[fd00::1]',
      ];
      for (const t of targets) {
        expect(() => handlers.testValidateFetchUrl(t)).toThrow('SSRF blocked');
      }
    });
  });

  describe('fetchSourceMapText', () => {
    it('fetches via native fetch', async () => {
      const oldFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'native-fetch-text' });
      const res = await handlers.testFetchSourceMapText('http://example.com');
      expect(res).toBe('native-fetch-text');
      global.fetch = oldFetch;
    });

    it('throws on native fetch non-ok', async () => {
      const oldFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
      // Throws HTTP error and falls back to evaluate
      mockEvaluateWithTimeout.mockResolvedValue('__FETCH_ERROR__evaluation fallback error');
      await expect(handlers.testFetchSourceMapText('http://example.com')).rejects.toThrow(
        'evaluation fallback error',
      );
      global.fetch = oldFetch;
    });

    it('throws custom error on abort', async () => {
      const oldFetch = global.fetch;
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      global.fetch = vi.fn().mockRejectedValue(abortErr);
      await expect(handlers.testFetchSourceMapText('http://example.com')).rejects.toThrow(
        'timed out after 10s',
      );
      global.fetch = oldFetch;
    });

    it('falls back to browser fetch if native throws regular error', async () => {
      const oldFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      mockEvaluateWithTimeout.mockResolvedValue('page-fetch-text');
      const res = await handlers.testFetchSourceMapText('http://example.com');
      expect(res).toBe('page-fetch-text');
      global.fetch = oldFetch;
    });

    it('throws if browser fetch returns non-string', async () => {
      const oldFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      mockEvaluateWithTimeout.mockResolvedValue(123); // invalid
      await expect(handlers.testFetchSourceMapText('http://example.com')).rejects.toThrow(
        'Failed to fetch SourceMap content',
      );
      global.fetch = oldFetch;
    });
  });

  describe('vlq logic', () => {
    it('fromVlqSigned', async () => {
      expect(handlers.testFromVlqSigned(0)).toBe(0);
      expect(handlers.testFromVlqSigned(2)).toBe(1);
      expect(handlers.testFromVlqSigned(3)).toBe(-1);
    });

    it('decodeVlqSegment', async () => {
      expect(handlers.testDecodeVlqSegment('A')).toEqual([0]);
      expect(handlers.testDecodeVlqSegment('C')).toEqual([1]);
      expect(handlers.testDecodeVlqSegment('D')).toEqual([-1]);
    });

    it('throws on incomplete vlq', async () => {
      expect(() => handlers.testDecodeVlqSegment('w')).toThrow('Unexpected end');
    });

    it('throws on invalid base64 char', async () => {
      expect(() => handlers.testDecodeVlqSegment('!')).toThrow('Invalid VLQ base64 char');
    });
  });

  describe('decodeMappings', () => {
    it('handles empty', async () => {
      expect(handlers.testDecodeMappings('')).toEqual([]);
    });

    it('decodes basic mappings', async () => {
      // "AAAA" is 0,0,0,0 (all zeros delta)
      // "AAAA;AAAA"
      const res = handlers.testDecodeMappings('AAAA;AACA');
      expect(res.length).toBe(2);
      expect(res[0!]!.generatedLine).toBe(1);
      expect(res[0!]!.generatedColumn).toBe(0);
      expect(res[1!]!.generatedLine).toBe(2);
      expect(res[1!]!.generatedColumn).toBe(0);
    });

    it('handles 5-segment mapping', async () => {
      // 5 segments (column, src, orgLine, orgCol, name)
      const res = handlers.testDecodeMappings('AAAAA');
      expect(res[0!]!.nameIndex).toBe(0);
    });

    it('skips invalid segments', async () => {
      const res = handlers.testDecodeMappings(';;,;');
      expect(res.length).toBe(0);
    });
  });

  describe('normalizeSourceMap', () => {
    it('validates version 3', async () => {
      expect(() => handlers.testNormalizeSourceMap({ version: 2 })).toThrow(
        'Only SourceMap version 3 is supported',
      );
    });
    it('requires mappings', async () => {
      expect(() => handlers.testNormalizeSourceMap({ version: 3 })).toThrow(
        'SourceMap.mappings is required',
      );
    });
    it('normalizes valid json', async () => {
      const res = handlers.testNormalizeSourceMap({
        version: 3,
        mappings: 'A',
        sources: ['a.js', 123],
        names: ['var', null],
        sourceRoot: 'root',
        sourcesContent: ['console.log(1)', null, 123],
      });
      expect(res.sources).toEqual(['a.js']);
      expect(res.names).toEqual(['var']);
      expect(res.sourceRoot).toBe('root');
      expect(res.sourcesContent).toEqual(['console.log(1)', null, null]);
    });
  });

  describe('loadSourceMap', () => {
    it('loads and normalizes from data URI', async () => {
      const v3 = { version: 3, mappings: 'A' };
      const b64 = Buffer.from(JSON.stringify(v3)).toString('base64');
      const loaded = await handlers.testLoadSourceMap(`data:application/json;base64,${b64}`);
      expect(loaded.map.version).toBe(3);
    });

    it('throws on invalid JSON', async () => {
      vi.spyOn(handlers as any, 'fetchSourceMapText').mockResolvedValue('invalid');
      await expect(handlers.testLoadSourceMap('http://example.com/map.js')).rejects.toThrow(
        'Invalid SourceMap JSON',
      );
    });

    it('fetches natively', async () => {
      vi.spyOn(handlers as any, 'fetchSourceMapText').mockResolvedValue(
        JSON.stringify({ version: 3, mappings: 'A' }),
      );
      const loaded = await handlers.testLoadSourceMap('http://example.com/map.js');
      expect(loaded.map.mappings).toBe('A');
    });
  });

  describe('parseSourceMap', () => {
    it('parses map and produces fully parsed result', async () => {
      vi.spyOn(handlers as any, 'loadSourceMap').mockResolvedValue({
        resolvedUrl: 'url',
        map: { version: 3, mappings: 'AAAA', sources: [], names: [] },
      });

      const res = await handlers.testParseSourceMap('url');
      expect(res.resolvedUrl).toBe('url');
      expect(res.segmentCount).toBe(1);
      expect(res.mappingsCount).toBe(1); // One unique line
    });
  });
});
