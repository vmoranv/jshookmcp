import { describe, expect, it } from 'vitest';
import { SourcemapToolHandlersParseBase } from '@server/domains/sourcemap/handlers.impl.sourcemap-parse-base';

class TestableParseBase extends SourcemapToolHandlersParseBase {
  constructor() {
    super(null as any);
  }

  public testDecodeMappings(mappings: string) {
    return this.decodeMappings(mappings);
  }

  public testDecodeVlqSegment(segment: string) {
    return this.decodeVlqSegment(segment);
  }

  public testFromVlqSigned(value: number) {
    return this.fromVlqSigned(value);
  }

  public testNormalizeSourceMap(value: unknown) {
    return this.normalizeSourceMap(value);
  }

  public testValidateFetchUrl(url: string) {
    return this.validateFetchUrl(url);
  }

  public testDecodeDataUriJson(dataUri: string) {
    return this.decodeDataUriJson(dataUri);
  }

  public testResolveSourceMapUrl(sourceMapUrl: string, scriptUrl: string) {
    return this.resolveSourceMapUrl(sourceMapUrl, scriptUrl);
  }

  public testExtractSourceMappingUrlFromScript(scriptSource: string) {
    return this.extractSourceMappingUrlFromScript(scriptSource);
  }

  public testHasProtocol(value: string) {
    return this.hasProtocol(value);
  }

  public testAsRecord(value: unknown) {
    return this.asRecord(value);
  }

  public testAsString(value: unknown) {
    return this.asString(value);
  }
}

const createTool = () => new TestableParseBase();

describe('SourcemapToolHandlersParseBase (parse-base)', () => {
  describe('decodeVlqSegment', () => {
    it('decodes single-value segments', () => {
      const tool = createTool();

      expect(tool.testDecodeVlqSegment('A')).toEqual([0]);
      expect(tool.testDecodeVlqSegment('C')).toEqual([1]);
      expect(tool.testDecodeVlqSegment('D')).toEqual([-1]);

      const b = tool.testDecodeVlqSegment('B');
      expect(b).toHaveLength(1);
      // fromVlqSigned(1) can produce -0; avoid Object.is-based matchers here.
      expect(b[0] === 0).toBe(true);
    });

    it('decodes multi-value segments', () => {
      const tool = createTool();

      expect(tool.testDecodeVlqSegment('AAAA')).toEqual([0, 0, 0, 0]);
      expect(tool.testDecodeVlqSegment('CDAA')).toEqual([1, -1, 0, 0]);
    });

    it('handles continuation bits for larger values', () => {
      const tool = createTool();

      // "g" (index 32) sets continuation bit with 0 payload, then "B" adds the next 5-bit group => raw=32 => signed=16
      expect(tool.testDecodeVlqSegment('gB')).toEqual([16]);
      expect(tool.testDecodeVlqSegment('gBA')).toEqual([16, 0]);
    });

    it('throws on invalid base64 characters', () => {
      const tool = createTool();
      expect(() => tool.testDecodeVlqSegment('?')).toThrow(/Invalid VLQ base64 char/);
    });

    it('throws on unexpected end (dangling continuation bit)', () => {
      const tool = createTool();
      expect(() => tool.testDecodeVlqSegment('g')).toThrow(/Unexpected end of VLQ segment/);
    });
  });

  describe('fromVlqSigned', () => {
    it('converts even values to positive numbers', () => {
      const tool = createTool();

      expect(tool.testFromVlqSigned(0)).toBe(0);
      expect(tool.testFromVlqSigned(2)).toBe(1);
      expect(tool.testFromVlqSigned(4)).toBe(2);
      expect(tool.testFromVlqSigned(6)).toBe(3);
    });

    it('converts odd values to negative numbers', () => {
      const tool = createTool();

      const negZero = tool.testFromVlqSigned(1);
      // Could be -0; treat it as 0 for semantics.
      expect(negZero === 0).toBe(true);

      expect(tool.testFromVlqSigned(3)).toBe(-1);
      expect(tool.testFromVlqSigned(5)).toBe(-2);
    });
  });

  describe('decodeMappings', () => {
    it('returns [] for empty mappings', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('')).toEqual([]);
    });

    it('decodes a single generated-only segment', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('A')).toEqual([{ generatedLine: 1, generatedColumn: 0 }]);
    });

    it('decodes a single full segment (AAAA)', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('AAAA')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ]);
    });

    it('decodes multiple segments on one line and tracks generatedColumn cumulatively', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('AAAA,CAAA,CAAA')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 1,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 2,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ]);
    });

    it('decodes multiple lines separated by ";" and resets generatedColumn per line', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('CAAA,CAAA;CAAA')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 1,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 2,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 2,
          generatedColumn: 1,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ]);
    });

    it('supports 5-value segments (nameIndex) and accumulates name deltas', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('AAAAC,AAAAC')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
          nameIndex: 1,
        },
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
          nameIndex: 2,
        },
      ]);
    });

    it('accumulates source/original deltas across segments', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('AAAA,CCAA,CACA,CAAC')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 1,
          sourceIndex: 1,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 2,
          sourceIndex: 1,
          originalLine: 2,
          originalColumn: 0,
        },
        {
          generatedLine: 1,
          generatedColumn: 3,
          sourceIndex: 1,
          originalLine: 2,
          originalColumn: 1,
        },
      ]);
    });

    it('skips empty lines (still advances generatedLine index)', () => {
      const tool = createTool();
      expect(tool.testDecodeMappings('AAAA;;AAAA')).toEqual([
        {
          generatedLine: 1,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
        {
          generatedLine: 3,
          generatedColumn: 0,
          sourceIndex: 0,
          originalLine: 1,
          originalColumn: 0,
        },
      ]);
    });
  });

  describe('normalizeSourceMap', () => {
    it('normalizes a valid v3 sourcemap', () => {
      const tool = createTool();
      const normalized = tool.testNormalizeSourceMap({
        version: 3,
        mappings: 'AAAA',
        sources: ['a.js', 123, null],
        names: ['n1', false, 'n2'],
        sourceRoot: '/src',
        sourcesContent: ['content-a', null, 42],
      });

      expect(normalized).toEqual({
        version: 3,
        mappings: 'AAAA',
        sources: ['a.js'],
        names: ['n1', 'n2'],
        sourceRoot: '/src',
        sourcesContent: ['content-a', null, null],
      });
    });

    it('throws when version is not 3', () => {
      const tool = createTool();

      expect(() => tool.testNormalizeSourceMap({ version: 4, mappings: 'A' })).toThrow(
        'Only SourceMap version 3 is supported'
      );
      expect(() => tool.testNormalizeSourceMap({ version: '3', mappings: 'A' })).toThrow(
        'Only SourceMap version 3 is supported'
      );
    });

    it('throws when mappings is missing or not a string', () => {
      const tool = createTool();

      expect(() => tool.testNormalizeSourceMap({ version: 3 })).toThrow(
        'SourceMap.mappings is required'
      );
      expect(() => tool.testNormalizeSourceMap({ version: 3, mappings: null })).toThrow(
        'SourceMap.mappings is required'
      );
    });

    it('defaults non-array sources/names to [] and leaves sourcesContent undefined when absent', () => {
      const tool = createTool();
      const normalized = tool.testNormalizeSourceMap({
        version: 3,
        mappings: 'A',
        sources: 'not-an-array',
        names: 123,
      });

      expect(normalized.sources).toEqual([]);
      expect(normalized.names).toEqual([]);
      expect(normalized.sourcesContent).toBeUndefined();
    });
  });

  describe('validateFetchUrl', () => {
    it('allows public http(s) urls', () => {
      const tool = createTool();
      expect(() => tool.testValidateFetchUrl('https://example.com/a.map')).not.toThrow();
      expect(() => tool.testValidateFetchUrl('http://example.com/a.map')).not.toThrow();
    });

    it('blocks localhost and metadata hostnames', () => {
      const tool = createTool();

      expect(() => tool.testValidateFetchUrl('http://localhost/a.map')).toThrow(
        'SSRF blocked: hostname "localhost" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://metadata.google.internal/a.map')).toThrow(
        'SSRF blocked: hostname "metadata.google.internal" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://metadata/a.map')).toThrow(
        'SSRF blocked: hostname "metadata" is not allowed'
      );
    });

    it('blocks protected/reserved IPv4 ranges', () => {
      const tool = createTool();

      expect(() => tool.testValidateFetchUrl('http://127.0.0.1/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "127.0.0.1" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://10.0.0.1/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "10.0.0.1" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://172.16.0.1/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "172.16.0.1" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://172.31.255.255/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "172.31.255.255" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://192.168.0.1/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "192.168.0.1" is not allowed'
      );
      expect(() => tool.testValidateFetchUrl('http://169.254.0.1/a.map')).toThrow(
        'SSRF blocked: protected/reserved IP "169.254.0.1" is not allowed'
      );
    });

    it('blocks IPv6 loopback', () => {
      const tool = createTool();
      expect(() => tool.testValidateFetchUrl('http://[::1]/a.map')).toThrow(
        /SSRF blocked: protected\/reserved IP ".*::1.*" is not allowed/
      );
    });

    it('rejects invalid urls and unsupported protocols', () => {
      const tool = createTool();

      expect(() => tool.testValidateFetchUrl('not a url')).toThrow('Invalid URL: not a url');
      expect(() => tool.testValidateFetchUrl('file:///etc/passwd')).toThrow(
        'Blocked: unsupported protocol "file:"'
      );
    });
  });

  describe('decodeDataUriJson', () => {
    it('decodes base64-encoded data: URIs', () => {
      const tool = createTool();
      const json = JSON.stringify({ hello: 'world', n: 1 });
      const base64 = Buffer.from(json, 'utf-8').toString('base64');
      const uri = `data:application/json;base64,${base64}`;
      expect(tool.testDecodeDataUriJson(uri)).toBe(json);
    });

    it('decodes URL-encoded data: URIs', () => {
      const tool = createTool();
      const json = JSON.stringify({ ok: true, list: [1, 2, 3] });
      const uri = `data:application/json,${encodeURIComponent(json)}`;
      expect(tool.testDecodeDataUriJson(uri)).toBe(json);
    });

    it('throws when data URI is missing a comma separator', () => {
      const tool = createTool();
      expect(() => tool.testDecodeDataUriJson('data:application/json;base64')).toThrow(
        'Invalid data URI source map'
      );
    });
  });

  describe('resolveSourceMapUrl', () => {
    it('returns empty string for blank input', () => {
      const tool = createTool();
      expect(tool.testResolveSourceMapUrl('   ', 'https://example.com/app.js')).toBe('');
    });

    it('returns data: URIs as-is (trimmed)', () => {
      const tool = createTool();
      expect(tool.testResolveSourceMapUrl(' data:application/json,{} ', 'https://x/y.js')).toBe(
        'data:application/json,{}'
      );
    });

    it('returns absolute URLs as-is', () => {
      const tool = createTool();
      expect(
        tool.testResolveSourceMapUrl('https://cdn.example.com/app.js.map', 'https://x/y.js')
      ).toBe('https://cdn.example.com/app.js.map');
    });

    it('resolves relative URLs against scriptUrl when provided', () => {
      const tool = createTool();
      expect(tool.testResolveSourceMapUrl('app.js.map', 'https://example.com/assets/app.js')).toBe(
        'https://example.com/assets/app.js.map'
      );
    });

    it('returns relative URLs unchanged when scriptUrl is empty', () => {
      const tool = createTool();
      expect(tool.testResolveSourceMapUrl(' app.js.map ', '')).toBe('app.js.map');
    });
  });

  describe('extractSourceMappingUrlFromScript', () => {
    it('extracts //# sourceMappingURL=... (preferred modern form)', () => {
      const tool = createTool();
      const script = ['console.log(1);', '//# sourceMappingURL=foo.js.map'].join('\n');
      expect(tool.testExtractSourceMappingUrlFromScript(script)).toBe('foo.js.map');
    });

    it('extracts //@ sourceMappingURL=... (legacy form)', () => {
      const tool = createTool();
      const script = ['console.log(1);', '//@ sourceMappingURL=bar.js.map'].join('\n');
      expect(tool.testExtractSourceMappingUrlFromScript(script)).toBe('bar.js.map');
    });

    it('extracts /*# sourceMappingURL=... */ block comment form', () => {
      const tool = createTool();
      const script = '/*# sourceMappingURL=baz.js.map */';
      expect(tool.testExtractSourceMappingUrlFromScript(script)).toBe('baz.js.map');
    });

    it('returns null when no sourceMappingURL is present', () => {
      const tool = createTool();
      expect(tool.testExtractSourceMappingUrlFromScript('console.log(1);')).toBeNull();
    });

    it('returns the last occurrence when multiple directives exist', () => {
      const tool = createTool();
      const script = [
        '//# sourceMappingURL=first.js.map',
        'console.log(1);',
        '/*# sourceMappingURL=second.js.map */',
      ].join('\n');

      expect(tool.testExtractSourceMappingUrlFromScript(script)).toBe('second.js.map');
    });
  });

  describe('hasProtocol', () => {
    it('detects strings with a protocol prefix', () => {
      const tool = createTool();
      expect(tool.testHasProtocol('https://example.com')).toBe(true);
      expect(tool.testHasProtocol('http://example.com')).toBe(true);
      expect(tool.testHasProtocol('/path')).toBe(false);
      expect(tool.testHasProtocol('relative')).toBe(false);
    });
  });

  describe('asRecord', () => {
    it('returns the same object when value is a non-null object', () => {
      const tool = createTool();
      const obj = { a: 1, b: 'x' };
      expect(tool.testAsRecord(obj)).toBe(obj);
    });

    it('returns {} for null/primitive/undefined', () => {
      const tool = createTool();
      expect(tool.testAsRecord(null)).toEqual({});
      expect(tool.testAsRecord('x')).toEqual({});
      expect(tool.testAsRecord(undefined)).toEqual({});
    });
  });

  describe('asString', () => {
    it('returns string values as-is', () => {
      const tool = createTool();
      expect(tool.testAsString('hello')).toBe('hello');
    });

    it('returns undefined for non-string values', () => {
      const tool = createTool();
      expect(tool.testAsString(123)).toBeUndefined();
      expect(tool.testAsString(null)).toBeUndefined();
      expect(tool.testAsString(undefined)).toBeUndefined();
    });
  });
});
