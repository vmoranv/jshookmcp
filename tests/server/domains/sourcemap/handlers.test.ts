import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcemapToolHandlers } from '../../../../src/server/domains/sourcemap/handlers';
import type { CodeCollector } from '../../../../src/server/domains/shared/modules';
import { evaluateWithTimeout } from '../../../../src/modules/collector/PageController';
import * as fsPromises from 'node:fs/promises';

import { resolveArtifactPath } from '@utils/artifacts';

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
  let handlers: SourcemapToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
    };
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
                url: 'http://example.com/app.js',
                sourceMapURL: 'app.js.map',
              });
            }
          }, 10);
        }
        return {};
      });

      const res = await handlers.handleSourcemapDiscover({ includeInline: false });
      // @ts-expect-error
      expect(res.content[0].text).toContain('app.js.map');
      // @ts-expect-error
      expect(res.content[0].text).toContain('http://example.com/app.js.map');
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
                url: 'http://example.com/app2.js',
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
      // @ts-expect-error
      expect(res.content[0].text).toContain('app2.js.map');
    });

    it('returns empty array if no maps found returning fast path', async () => {
      const res = await handlers.handleSourcemapDiscover({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('[]');
    });

    it('handles session communication errors globally', async () => {
      sessionMock.send.mockRejectedValue(new Error('CDP error'));
      const res = await handlers.handleSourcemapDiscover({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('CDP error');
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
        sourceMapUrl: 'http://example.com/test.map',
        scriptUrl: 'http://example.com/test.js',
      });

      // @ts-expect-error
      expect(res.content[0].text).toContain('mappingsCount');
      // @ts-expect-error
      expect(res.content[0].text).toContain('index.ts');
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

      // @ts-expect-error
      expect(res.content[0].text).toContain('inline.ts');
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
        sourceMapUrl: 'http://example.com/err.map',
        scriptUrl: 'http://example.com/test.js',
      });

      // @ts-expect-error
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('sourcemap_fetch_and_parse');
      expect(parsed.error).toContain('Invalid VLQ base64 char');
    });

    it('handles restricted domains for SSRF filtering appropriately', async () => {
      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://169.254.169.254/meta.map',
      });
      // @ts-expect-error
      expect(res.content[0].text).toContain('SSRF blocked');
    });

    it('falls back to evaluateWithTimeout on fetch failure timeout or block', async () => {
      globalFetch.mockRejectedValue(new Error('Fetch failed'));
      const mockMap = { version: 3, sources: ['fallback.ts'], mappings: 'AAAA', names: [] };
      vi.mocked(evaluateWithTimeout).mockResolvedValue(JSON.stringify(mockMap));

      const res = await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'http://example.com/fallback.map',
      });
      // @ts-expect-error
      expect(res.content[0].text).toContain('fallback.ts');
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
        sourceMapUrl: 'http://example.com/tree.map',
      });
      // @ts-expect-error
      if (res.content[0].text.includes('"success": false')) {
        // @ts-expect-error
        console.error('Tree error 1:', res.content[0].text);
      }

      // @ts-expect-error
      expect(res.content[0].text).toContain('"writtenFiles": 2');
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
        sourceMapUrl: 'http://example.com/fail.map',
      });

      // @ts-expect-error
      expect(res.content[0].text).toContain('"skippedFiles": 1');
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
          { targetId: '2', type: 'page', url: 'http://example.com' },
        ],
      });

      const res = await handlers.handleExtensionListInstalled({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('abcdefghijklmnopabcdefghijklmnop');
      // @ts-expect-error
      expect(res.content[0].text).toContain('Test Ext');
    });

    it('succeeds gracefully when none exist', async () => {
      sessionMock.send.mockResolvedValue({});
      const res = await handlers.handleExtensionListInstalled({});
      // @ts-expect-error
      expect(res.content[0].text).toContain('[]');
    });
  });

  describe('handleExtensionExecuteInContext', () => {
    it('wires code through target execution correctly mapped to sessions', async () => {
      sessionMock.send.mockImplementation(async (method: string, params: any) => {
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
        if (method === 'Target.sendMessageToTarget') {
          setTimeout(() => {
            const onMsg = sessionMock.on.mock.calls.find(
              (c: any) => c[0] === 'Target.receivedMessageFromTarget',
            )[1];
            onMsg({
              sessionId: 'sess1',
              message: JSON.stringify({
                id: JSON.parse(params.message).id,
                result: { result: 'execution_result' },
              }),
            });
          }, 10);
          return {};
        }
        return {};
      });

      const res = await handlers.handleExtensionExecuteInContext({
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        code: '1+1',
      });
      // @ts-expect-error
      expect(res.content[0].text).toContain('execution_result');
    });

    it('rejects without available targets quickly', async () => {
      sessionMock.send.mockResolvedValue({ targetInfos: [] });
      const res = await handlers.handleExtensionExecuteInContext({
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
        code: '1+1',
      });
      // @ts-expect-error
      expect(res.content[0].text).toContain('No background target found');
    });
  });
});
