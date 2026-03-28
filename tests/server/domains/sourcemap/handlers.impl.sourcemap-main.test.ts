import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { SourcemapToolHandlersMain } from '../../../../src/server/domains/sourcemap/handlers.impl.sourcemap-main';
import { CodeCollector } from '../../../../src/modules/collector/CodeCollector';

// Mock fs/promises completely to avoid real filesystem side effects
vi.mock('node:fs/promises', async () => {
  return {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi
    .fn()
    .mockResolvedValue({ absolutePath: '/fake/dir/file.tmp', displayPath: '/fake/dir/file.tmp' }),
}));

describe('SourcemapToolHandlersMain', () => {
  let handlers: SourcemapToolHandlersMain;
  let mockcollector: any;
  let mockSession: any;
  let mockPage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockcollector = { getActivePage: vi.fn() };

    mockSession = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
    };

    mockPage = {
      createCDPSession: vi.fn().mockResolvedValue(mockSession),
    };

    mockcollector.getActivePage.mockResolvedValue(mockPage);
    handlers = new SourcemapToolHandlersMain(mockcollector as unknown as CodeCollector);
  });

  // @ts-expect-error — auto-suppressed [TS6133]
  const _dummyArgs = {
    sourceMapUrl: 'http://test.com/map.js.map',
  };

  it('instantiates correctly', () => {
    expect(handlers).toBeInstanceOf(SourcemapToolHandlersMain);
  });

  describe('handleSourcemapDiscover', () => {
    it('discovers scripts with sourcemap url natively', async () => {
      mockSession.send.mockImplementation(async (method: string) => {
        if (method === 'Debugger.enable') {
          // trigger fake script parsed events immediately
          const onCall = mockSession.on.mock.calls.find(
            (c: any) => c[0] === 'Debugger.scriptParsed',
          );
          if (onCall) {
            onCall[1]({
              scriptId: '1',
              url: 'http://example.com/a.js',
              sourceMapURL: 'http://example.com/a.js.map',
            });
            onCall[1]({ scriptId: '2', url: 'http://example.com/b.js' }); // no map
            onCall[1]({
              scriptId: '3',
              url: 'http://example.com/c.js',
              sourceMapURL: 'data:application/json;base64,123',
            }); // inline
          }
        }
        return {};
      });

      // Need to resolve immediately instead of delay
      vi.spyOn(handlers as any, 'delay').mockResolvedValue(undefined);
      vi.spyOn(handlers as any, 'resolveSourceMapUrl').mockImplementation((_a: any, _b: any) => _a);

      const res = await handlers.handleSourcemapDiscover({ includeInline: false });
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].scriptId).toBe('1');
    });

    it('falls back to fetching script source if no map url in event', async () => {
      mockSession.send.mockImplementation(async (method: string, _params: any) => {
        if (method === 'Debugger.enable') {
          const onCall = mockSession.on.mock.calls.find(
            (c: any) => c[0] === 'Debugger.scriptParsed',
          );
          if (onCall) onCall[1]({ scriptId: '2', url: 'http://example.com/b.js' }); // no map
          return {};
        }
        if (method === 'Debugger.getScriptSource') {
          return { scriptSource: 'console.log("foo"); //# sourceMappingURL=b.js.map' };
        }
        return {};
      });

      vi.spyOn(handlers as any, 'delay').mockResolvedValue(undefined);
      vi.spyOn(handlers as any, 'resolveSourceMapUrl').mockReturnValue(
        'http://example.com/b.js.map',
      );
      vi.spyOn(handlers as any, 'extractSourceMappingUrlFromScript').mockReturnValue('b.js.map');

      const res = await handlers.handleSourcemapDiscover({ includeInline: true });
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].sourceMapUrl).toBe('http://example.com/b.js.map');
    });

    it('throws when getActivePage fails', async () => {
      mockcollector.getActivePage.mockRejectedValue(new Error('fail3'));
      await expect(handlers.handleSourcemapDiscover({})).rejects.toThrow('fail3');
    });
  });

  describe('handleSourcemapFetchAndParse', () => {
    it('fetches and returns limited sources payload', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        map: { sources: ['a.ts'], sourcesContent: ['code'] },
        mappingsCount: 1,
        segmentCount: 1,
      });

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://foo.com/map.js.map',
      });
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.sources).toEqual(['a.ts']);
      expect(parsed.sourcesContent).toEqual(['code']);
      expect(parsed.mappingsCount).toBe(1);
    });

    it('handles error from parse', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockRejectedValue(new Error('parse error'));

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://foo.com/map',
      });
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('parse error');
    });
  });

  describe('handleSourcemapReconstructTree', () => {
    it('reconstructs tree to artifact directory', async () => {
      // Mock base methods
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'http://example.com/source.map',
        map: {
          sourceRoot: '/test',
          sources: ['src/a.ts', 'src/b.ts'],
          sourcesContent: ['console.log("a")', null], // one with content, one without
        },
      });
      vi.spyOn(handlers as any, 'safeTarget').mockReturnValue('target');
      vi.spyOn(handlers as any, 'combineSourceRoot').mockImplementation((_r: any, s: any) => s);
      vi.spyOn(handlers as any, 'normalizeSourcePath').mockImplementation((s: any) => s);

      const artifacts = await import('../../../../src/utils/artifacts');
      vi.spyOn(artifacts, 'resolveArtifactPath').mockResolvedValue({
        absolutePath: '/fake/dir/file.tmp',
        displayPath: '/fake/dir/file.tmp',
      });

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: 'http://foo.com/map',
        outputDir: '/out',
      });
      if ((res as any).isError) {
        throw new Error('Handler returned error: ' + JSON.stringify(res.content));
      }
      const parsed = JSON.parse((res.content[0] as any).text);

      expect(parsed.files).toContain('src/a.ts');
      // src/b.ts has no content so it gets written as null comment
      expect(parsed.files).toContain('src/b.ts');
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);
      expect(fsPromises.mkdir).toHaveBeenCalled();
    });

    it('handles error during reconstruct', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockRejectedValue(new Error('no map found'));

      const res = await handlers.handleSourcemapReconstructTree({
        sourceMapUrl: 'http://foo.com/map',
      });
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('no map found');
    });
  });
});
