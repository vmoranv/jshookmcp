import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcemapToolHandlers } from '../../../../src/server/domains/sourcemap/handlers';
import type { CodeCollector } from '../../../../src/server/domains/shared/modules/collector';
import { evaluateWithTimeout } from '../../../../src/modules/collector/PageController';
import * as fsPromises from 'node:fs/promises';

import { resolveArtifactPath } from '@utils/artifacts';
import { TEST_HTTP_URLS, withPath } from '@tests/shared/test-urls';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';

function getText(res: { content: Array<{ type: string; text?: string }> }): string {
  const block = res.content[0];
  return block?.text ?? '';
}

vi.mock('../../../../src/modules/collector/PageController', () => ({
  evaluateWithTimeout: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(),
}));

const globalFetch = vi.fn();
global.fetch = globalFetch as unknown as typeof fetch;

describe('SourcemapToolHandlers', () => {
  // @ts-expect-error
  let collectorMock: vi.Mocked<CodeCollector>;
  let pageMock: any;
  let sessionMock: any;
  let attachedSessionMock: any;
  let handlers: SourcemapToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
      connection: vi.fn(),
    };
    attachedSessionMock = {
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
      id: vi.fn(() => 'sess1'),
    };
    sessionMock.connection.mockReturnValue({
      session: vi.fn((sessionId: string) => (sessionId === 'sess1' ? attachedSessionMock : null)),
    });
    pageMock = {
      createCDPSession: vi.fn().mockResolvedValue(sessionMock),
    };
    collectorMock = {
      getActivePage: vi.fn().mockResolvedValue(pageMock),
    } as any;

    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(resolveArtifactPath).mockResolvedValue({
      absolutePath: '/mock/path.tmp',
      displayPath: '/mock/path.tmp',
    });

    handlers = new SourcemapToolHandlers(collectorMock);
  });

  describe('handleSourcemapDiscover', () => {
    it('discovers source maps from scriptParsed events', async () => {
      let scriptParsedCallback: any;
      sessionMock.on.mockImplementation((event: string, cb: any) => {
        if (event === 'Debugger.scriptParsed') scriptParsedCallback = cb;
      });

      sessionMock.send.mockImplementation(async (method: string, _params: any) => {
        if (method === 'Debugger.enable') {
          setTimeout(() => {
            if (scriptParsedCallback) {
              scriptParsedCallback({
                scriptId: '1',
                url: withPath(TEST_HTTP_URLS.root, 'app.js'),
                sourceMapURL: 'app.js.map',
              });
            }
          }, 10);
        }
        return {};
      });

      const res = await handlers.handleSourcemapDiscover({ includeInline: false });
      expect(getText(res)).toContain('app.js.map');
      expect(getText(res)).toContain(withPath(TEST_HTTP_URLS.root, 'app.js.map'));
    });

    it('falls back to fetching script source for map extraction over CDP', async () => {
      let scriptParsedCallback: any;
      sessionMock.on.mockImplementation((event: string, cb: any) => {
        if (event === 'Debugger.scriptParsed') scriptParsedCallback = cb;
      });

      sessionMock.send.mockImplementation(async (method: string, params: any) => {
        if (method === 'Debugger.enable') {
          setTimeout(() => {
            if (scriptParsedCallback) {
              scriptParsedCallback({
                scriptId: '2',
                url: withPath(TEST_HTTP_URLS.root, 'app2.js'),
              });
            }
          }, 10);
        }
        if (method === 'Debugger.getScriptSource' && params.scriptId === '2') {
          return { scriptSource: 'console.log();\n//# sourceMappingURL=app2.js.map' };
        }
        return {};
      });

      const res = await handlers.handleSourcemapDiscover({});
      expect(getText(res)).toContain('app2.js.map');
    });

    it('returns empty array if no maps found returning fast path', async () => {
      const res = await handlers.handleSourcemapDiscover({});
      expect(getText(res)).toContain('[]');
    });

    it('keeps discover wrapper responses un-nested', async () => {
      const res = await handlers.handleSourcemapDiscoverTool({});
      const body = JSON.parse(getText(res));
      expect(body).toEqual([]);
      expect(body.content).toBeUndefined();
    });

    it('turns wrapper discovery failures into structured errors', async () => {
      collectorMock.getActivePage.mockRejectedValueOnce(new Error('no page'));
      const res = await handlers.handleSourcemapDiscoverTool({});
      const body = ResponseBuilder.parse<Record<string, unknown>>(res);
      expect(body).toMatchObject({
        success: false,
        error: 'no page',
        message: 'no page',
      });
    });

    it('handles session communication errors globally', async () => {
      sessionMock.send.mockRejectedValue(new Error('CDP error'));
      const res = await handlers.handleSourcemapDiscover({});
      expect(getText(res)).toContain('CDP error');
    });
  });

  describe('handleSourcemapFetchAndParse', () => {
    it('fetches and parses a valid source map via global stubbed server fetch', async () => {
      const mockMap = {
        version: 3,
        sources: ['index.ts'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'test.map'),
        scriptUrl: withPath(TEST_HTTP_URLS.root, 'test.js'),
      });

      expect(getText(res)).toContain('mappingsCount');
      expect(getText(res)).toContain('index.ts');
    });

    it('fetches and parses data URI source map locally immediately', async () => {
      const mockMap = {
        version: 3,
        sources: ['inline.ts'],
        mappings: 'AAAA',
        names: [],
      };
      const b64 = Buffer.from(JSON.stringify(mockMap)).toString('base64');
      const dataUri = `data:application/json;base64,${b64}`;

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: dataUri,
      });

      expect(getText(res)).toContain('inline.ts');
    });

    it('surfaces corrupted VLQ payloads as parse errors', async () => {
      const mockMap = {
        version: 3,
        sources: ['error.ts'],
        mappings: '!!!INVALID!!!',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'err.map'),
        scriptUrl: withPath(TEST_HTTP_URLS.root, 'test.js'),
      });

      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('sourcemap_fetch_and_parse');
      expect(parsed.error).toContain('Invalid VLQ base64 char');
    });

    it('handles restricted domains for SSRF filtering appropriately', async () => {
      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://169.254.169.254/meta.map',
      });
      expect(getText(res)).toContain('SSRF blocked');
    });

    it('blocks IPv4-mapped IPv6 loopback source map URLs before fetch fallback', async () => {
      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://[::ffff:127.0.0.1]/meta.map',
      });
      const parsed = JSON.parse(getText(res) || '{}');

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('SSRF blocked');
      expect(globalFetch).not.toHaveBeenCalled();
      expect(evaluateWithTimeout).not.toHaveBeenCalled();
    });

    it('falls back to evaluateWithTimeout on fetch failure timeout or block', async () => {
      globalFetch.mockRejectedValue(new Error('Fetch failed'));
      const mockMap = { version: 3, sources: ['fallback.ts'], mappings: 'AAAA', names: [] };
      vi.mocked(evaluateWithTimeout).mockResolvedValue(JSON.stringify(mockMap));

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'fallback.map'),
      });
      expect(getText(res)).toContain('fallback.ts');
    });
  });

  describe('handleSourcemapCoverage', () => {
    it('computes per-source coverage from decoded mappings', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts', 'src/b.ts'],
        sourcesContent: ['aaaaaa', 'bbb'],
        mappings: 'AAAA,CAAC;ACCF',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapCoverage({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'coverage.map'),
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.resolvedUrl).toBe(withPath(TEST_HTTP_URLS.root, 'coverage.map'));
      expect(parsed.totalMappings).toBe(3);
      expect(parsed.mappedSourceCount).toBe(2);
      expect(parsed.coveredBytes).toBe(3);
      expect(parsed.uncoveredGeneratedBytes).toBe(0);
      expect(parsed.buckets).toEqual([
        {
          source: '[unmapped]',
          generatedSegments: 0,
          coveredBytes: 0,
        },
      ]);
      expect(parsed.sources).toEqual([
        {
          source: 'src/a.ts',
          generatedSegments: 2,
          mappedBytes: 2,
          coveredBytes: 2,
          unmappedBytes: 4,
          coveragePercent: 33.33,
          coveredPercent: 33.33,
          sourceContentBytes: 6,
        },
        {
          source: 'src/b.ts',
          generatedSegments: 1,
          mappedBytes: 1,
          coveredBytes: 1,
          unmappedBytes: 2,
          coveragePercent: 33.33,
          coveredPercent: 33.33,
          sourceContentBytes: 3,
        },
      ]);
    });

    it('returns null coverage when sourcesContent is missing', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapCoverage({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'coverage-missing.map'),
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.sources).toEqual([
        {
          source: 'src/a.ts',
          generatedSegments: 1,
          mappedBytes: 1,
          coveredBytes: 1,
          unmappedBytes: null,
          coveragePercent: null,
          coveredPercent: null,
          sourceContentBytes: null,
        },
      ]);
    });

    it('tracks generated bytes with no source mapping in an unmapped bucket', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        sourcesContent: ['aaaa'],
        mappings: 'A,AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapCoverage({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'coverage-unmapped.map'),
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.uncoveredGeneratedBytes).toBe(1);
      expect(parsed.buckets).toEqual([
        {
          source: '[unmapped]',
          generatedSegments: 1,
          coveredBytes: 1,
        },
      ]);
    });

    it('reports coverage errors with tool name', async () => {
      const res = await handlers.handleSourcemapCoverage({
        sourceMapUrl: 'http://169.254.169.254/blocked.map',
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('sourcemap_coverage');
    });
  });

  describe('handleSourcemapLookup', () => {
    it('resolves an exact generated position to original source', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA,CAAC',
        names: ['lookupName'],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'lookup.map'),
        line: 1,
        column: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(true);
      expect(parsed.matchType).toBe('exact');
      expect(parsed.original.source).toBe('src/a.ts');
      expect(parsed.original.line).toBe(1);
      expect(parsed.original.column).toBe(0);
    });

    it('falls back to closest preceding mapping on the same line', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA,CAAC',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'lookup-nearest.map'),
        line: 1,
        column: 1.5,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(true);
      expect(parsed.matchType).toBe('closest-preceding');
    });

    it('rejects invalid line input', async () => {
      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'lookup-invalid.map'),
        line: 0,
        column: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('sourcemap_lookup');
    });

    // ── Reverse lookup (original -> generated) ──

    it('resolves an original source:line:col back to the generated position', async () => {
      // mappings: gen1:0 -> orig a.ts:1:0 (AAAA); gen3:0 -> orig a.ts:2:0 (AACA)
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA;;AACA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'reverse.map'),
        originalSource: 'src/a.ts',
        originalLine: 2,
        originalColumn: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(true);
      expect(parsed.generated).toBeDefined();
      expect(parsed.generated.line).toBe(3);
      expect(parsed.matchType).toBe('exact');
    });

    it('falls back to closest preceding original mapping for reverse lookup', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA,CAAC',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'reverse-nearest.map'),
        originalSource: 'src/a.ts',
        originalLine: 5,
        originalColumn: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(true);
      expect(parsed.matchType).toBe('closest-preceding');
    });

    it('reports an error when the original source is not in the map', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'reverse-missing.map'),
        originalSource: 'src/missing.ts',
        originalLine: 1,
        originalColumn: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/not present/);
    });

    it('rejects invalid originalLine in reverse lookup', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/a.ts'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'reverse-badline.map'),
        originalSource: 'src/a.ts',
        originalLine: 0,
        originalColumn: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('sourcemap_lookup');
    });
  });

  describe('indexed (sectioned) source maps', () => {
    it('fetch_and_parse flattens indexed source maps into a single v3 map', async () => {
      // Two sections, each pinning a tiny embedded map at an offset.
      const indexed = {
        version: 3,
        file: 'app.js',
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['src/a.ts'],
              sourcesContent: ['export const a = 1;'],
              names: [],
              mappings: 'AAAA',
            },
          },
          {
            offset: { line: 5, column: 0 },
            map: {
              version: 3,
              sources: ['src/b.ts'],
              sourcesContent: ['export const b = 2;'],
              names: [],
              mappings: 'AAAA',
            },
          },
        ],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(indexed)),
      });

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'indexed.map'),
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.sources).toEqual(['src/a.ts', 'src/b.ts']);
      expect(parsed.segmentCount).toBeGreaterThan(0);
    });

    it('lookup works against an indexed source map after flattening', async () => {
      const indexed = {
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ['src/a.ts'],
              names: [],
              mappings: 'AAAA',
            },
          },
          {
            offset: { line: 10, column: 0 },
            map: {
              version: 3,
              sources: ['src/b.ts'],
              names: [],
              mappings: 'AAAA',
            },
          },
        ],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(indexed)),
      });

      const res = await handlers.handleSourcemapLookup({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'indexed-lookup.map'),
        line: 1,
        column: 0,
      });
      const parsed = JSON.parse(getText(res) || '{}');
      expect(parsed.success).toBe(true);
      expect(parsed.original.source).toBe('src/a.ts');
    });
  });

  describe('handleSourcemapReconstructTree', () => {
    it('reconstructs mapped trees and triggers files extraction paths', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/app.ts', 'src/lib.ts'],
        sourcesContent: ['console.log("app");', null],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'tree.map'),
      });
      if (getText(res).includes('"success": false')) {
        console.error('Tree error 1:', getText(res));
      }

      expect(getText(res)).toContain('"writtenFiles": 2');
      expect(fsPromises.mkdir).toHaveBeenCalled();
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);
    });

    it('bypasses failed writes safely on disk fail bounds', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/fail.ts'],
        sourcesContent: ['content'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(new Error('Disk full'));

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'fail.map'),
      });

      expect(getText(res)).toContain('"skippedFiles": 1');
    });

    it('skips sources that still escape the output root after normalization', async () => {
      const mockMap = {
        version: 3,
        sources: ['..'],
        sourcesContent: ['content'],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      vi.mocked(resolveArtifactPath).mockResolvedValue({
        absolutePath: '/',
        displayPath: '/',
      });
      const normalizeSpy = vi
        .spyOn(
          await import('../../../../src/server/domains/sourcemap/handlers/sourcemap-parsing'),
          'normalizeSourcePath',
        )
        .mockReturnValue('..');

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'escape.map'),
      });

      expect(getText(res)).toContain('"writtenFiles": 0');
      expect(getText(res)).toContain('"skippedFiles": 1');
      normalizeSpy.mockRestore();
    });

    it('writes an inferred skeleton for stripped sourcesContent when inferMissing=true', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/app.ts', 'src/lib.ts'],
        sourcesContent: ['console.log("app");', null],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'infer.map'),
        inferMissing: true,
      });

      expect(getText(res)).toContain('"writtenFiles": 2');
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);
      // the stripped source (src/lib.ts) gets an inferred skeleton, not the placeholder
      const strippedContent = vi
        .mocked(fsPromises.writeFile)
        .mock.calls.map((c) => c[1])
        .find((c) => typeof c === 'string' && (c as string).includes('Inferred source skeleton'));
      expect(strippedContent).toBeDefined();
    });

    it('keeps the placeholder for stripped sourcesContent when inferMissing is false (default)', async () => {
      const mockMap = {
        version: 3,
        sources: ['src/app.ts', 'src/lib.ts'],
        sourcesContent: ['console.log("app");', null],
        mappings: 'AAAA',
        names: [],
      };
      globalFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockMap)),
      });

      await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: withPath(TEST_HTTP_URLS.root, 'placeholder.map'),
      });

      const strippedContent = vi
        .mocked(fsPromises.writeFile)
        .mock.calls.map((c) => c[1])
        .find((c) => typeof c === 'string' && (c as string).includes('source content missing'));
      expect(strippedContent).toBeDefined();
    });
  });

  describe('handleExtensionListInstalled', () => {
    it('filters valid extension backgrounds accurately', async () => {
      sessionMock.send.mockResolvedValue({
        targetInfos: [
          {
            targetId: '1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
            title: 'Test Ext',
          },
          { targetId: '2', type: 'page', url: TEST_HTTP_URLS.root },
        ],
      });

      const res = await handlers.handleExtensionListInstalled({});
      expect(getText(res)).toContain('abcdefghijklmnopabcdefghijklmnop');
      expect(getText(res)).toContain('Test Ext');
    });

    it('succeeds gracefully when none exist', async () => {
      sessionMock.send.mockResolvedValue({});
      const res = await handlers.handleExtensionListInstalled({});
      expect(getText(res)).toContain('[]');
    });
  });

  describe('handleExtensionExecuteInContext', () => {
    it('wires code through target execution correctly mapped to sessions', async () => {
      sessionMock.send.mockImplementation(async (method: string) => {
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [
              {
                targetId: 'ext1',
                type: 'service_worker',
                url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js',
              },
            ],
          };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'sess1' };
        return {};
      });
      attachedSessionMock.send.mockResolvedValue({
        result: { value: 'execution_result' },
      });

      const res = await handlers.handleExtensionExecuteInContext({
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        code: '1+1',
      });
      expect(getText(res)).toContain('execution_result');
      expect(attachedSessionMock.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: '1+1',
        returnByValue: true,
        awaitPromise: true,
      });
      expect(sessionMock.send).toHaveBeenCalledWith('Target.detachFromTarget', {
        sessionId: 'sess1',
      });
      expect(attachedSessionMock.detach).not.toHaveBeenCalled();
    });

    it('rejects without available targets quickly', async () => {
      sessionMock.send.mockResolvedValue({ targetInfos: [] });
      const res = await handlers.handleExtensionExecuteInContext({
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        code: '1+1',
      });
      expect(getText(res)).toContain('No background target found');
    });
  });
});
