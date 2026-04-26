import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/artifacts/sourcemap-tree/test_map.tmp',
    displayPath: 'artifacts/sourcemap-tree/test_map.tmp',
  })),
}));

import { createPageMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { SourcemapToolHandlersExtension } from '@server/domains/sourcemap/handlers.impl.sourcemap-extension';
import { SourcemapToolHandlersMain } from '@server/domains/sourcemap/handlers.impl.sourcemap-main';
import type { ExtensionTarget } from '@server/domains/sourcemap/handlers.impl.sourcemap-parse-base';

class TestSourcemapToolHandlersExtension extends SourcemapToolHandlersExtension {
  public override async getExtensionTargets(session: any, expectedExtensionId?: string) {
    return super.getExtensionTargets(session, expectedExtensionId);
  }
  public override pickPreferredExtensionTarget(targets: ExtensionTarget[]) {
    return super.pickPreferredExtensionTarget(targets);
  }
  public override extractExtensionId(url: string) {
    return super.extractExtensionId(url);
  }
  public override async evaluateInAttachedTarget(
    session: any,
    code: string,
    returnByValue: boolean,
  ) {
    return super.evaluateInAttachedTarget(session, code, returnByValue);
  }
}

describe('SourcemapToolHandlersExtension', () => {
  let handlers: TestSourcemapToolHandlersExtension;
  let session: any;
  let attachedSession: any;
  let page: any;
  let collector: any;

  beforeEach(() => {
    vi.clearAllMocks();
    attachedSession = {
      send: vi.fn(),
      id: vi.fn(() => 'attached-sid'),
      detach: vi.fn(async () => undefined),
    };
    session = {
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      detach: vi.fn(),
      connection: vi.fn(),
    };
    session.connection.mockReturnValue({
      session: vi.fn((sessionId: string) =>
        sessionId === 'attached-sid' ? attachedSession : null,
      ),
    });
    page = createPageMock({
      // @ts-expect-error — auto-suppressed [TS2353]
      createCDPSession: vi.fn(async () => session),
    });
    collector = {
      getActivePage: vi.fn(async () => page),
    };
    handlers = new TestSourcemapToolHandlersExtension(collector as any);
  });

  // ── getExtensionTargets ────────────────────────────────────────────

  describe('getExtensionTargets', () => {
    it('filters targets to only service_worker and background_page', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
            title: 'Ext A',
          },
          {
            targetId: 't2',
            type: 'page',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
            title: 'Popup',
          },
          {
            targetId: 't3',
            type: 'background_page',
            url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/bg.html',
            title: 'Ext B',
          },
          { targetId: 't4', type: 'iframe', url: 'https://example.com', title: 'Frame' },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      expect(targets).toHaveLength(2);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[0].type).toBe('service_worker');
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[1].type).toBe('background_page');
    });

    it('extracts extensionId from chrome-extension URL', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
            title: '',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[0].extensionId).toBe('abcdefghijklmnopabcdefghijklmnop');
    });

    it('filters by expectedExtensionId when provided', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
            title: 'A',
          },
          {
            targetId: 't2',
            type: 'service_worker',
            url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/sw.js',
            title: 'B',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(
        session,
        'ponmlkjihgfedcbaponmlkjihgfedcba',
      );
      expect(targets).toHaveLength(1);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[0].extensionId).toBe('ponmlkjihgfedcbaponmlkjihgfedcba');
    });

    it('skips entries with missing targetId', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
            title: 'No ID',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });

    it('skips non-extension URLs', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'service_worker',
            url: 'https://example.com/sw.js',
            title: 'Not ext',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });

    it('uses extensionId as name when title is empty', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'service_worker',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
            title: '',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[0].name).toBe('abcdefghijklmnopabcdefghijklmnop');
    });

    it('sorts service_workers before background_pages', async () => {
      session.send.mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: 't1',
            type: 'background_page',
            url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/bg.html',
            title: 'BG',
          },
          {
            targetId: 't2',
            type: 'service_worker',
            url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/sw.js',
            title: 'SW',
          },
        ],
      });

      const targets = await handlers.getExtensionTargets(session);
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[0].type).toBe('service_worker');
      // @ts-expect-error — auto-suppressed [TS2532]
      expect(targets[1].type).toBe('background_page');
    });

    it('handles empty targetInfos array', async () => {
      session.send.mockResolvedValueOnce({ targetInfos: [] });

      const targets = await handlers.getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });

    it('handles missing targetInfos in response', async () => {
      session.send.mockResolvedValueOnce({});

      const targets = await handlers.getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });
  });

  // ── pickPreferredExtensionTarget ───────────────────────────────────

  describe('pickPreferredExtensionTarget', () => {
    it('prefers service_worker over background_page', async () => {
      const targets: ExtensionTarget[] = [
        {
          targetId: 't1',
          extensionId: 'ext1',
          name: 'BG',
          type: 'background_page',
          url: 'bg.html',
        },
        { targetId: 't2', extensionId: 'ext1', name: 'SW', type: 'service_worker', url: 'sw.js' },
      ];

      const result = handlers.pickPreferredExtensionTarget(targets);
      expect(result.type).toBe('service_worker');
    });

    it('falls back to first target if no service_worker', async () => {
      const targets: ExtensionTarget[] = [
        {
          targetId: 't1',
          extensionId: 'ext1',
          name: 'BG',
          type: 'background_page',
          url: 'bg.html',
        },
      ];

      const result = handlers.pickPreferredExtensionTarget(targets);
      expect(result.type).toBe('background_page');
    });
  });

  // ── extractExtensionId ─────────────────────────────────────────────

  describe('extractExtensionId', () => {
    it('extracts ID from valid chrome-extension URL', async () => {
      const id = handlers.extractExtensionId(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js',
      );
      expect(id).toBe('abcdefghijklmnopabcdefghijklmnop');
    });

    it('returns null for non-chrome-extension URL', async () => {
      const id = handlers.extractExtensionId('https://example.com/sw.js');
      expect(id).toBeNull();
    });

    it('returns null for invalid extension ID format', async () => {
      const id = handlers.extractExtensionId('chrome-extension://short/sw.js');
      expect(id).toBeNull();
    });

    it('handles URL with no path after extension ID', async () => {
      const id = handlers.extractExtensionId('chrome-extension://abcdefghijklmnopabcdefghijklmnop');
      expect(id).toBe('abcdefghijklmnopabcdefghijklmnop');
    });
  });

  // ── evaluateInAttachedTarget ───────────────────────────────────────

  describe('evaluateInAttachedTarget', () => {
    it('returns by-value results directly', async () => {
      const evalSession = {
        send: vi.fn(async () => ({ result: { value: 3 } })),
      };

      await expect(handlers.evaluateInAttachedTarget(evalSession, '1+2', true)).resolves.toEqual({
        result: 3,
        exceptionDetails: null,
      });
    });

    it('throws when Runtime.evaluate fails', async () => {
      const evalSession = {
        send: vi.fn(async () => {
          throw new Error('Send failed: session closed');
        }),
      };

      await expect(handlers.evaluateInAttachedTarget(evalSession, '1+1', true)).rejects.toThrow(
        'Send failed: session closed',
      );
    });
  });

  // ── handleExtensionListInstalled ───────────────────────────────────

  describe('handleExtensionListInstalled', () => {
    it('returns list of installed extensions', async () => {
      vi.spyOn(handlers, 'getExtensionTargets').mockResolvedValue([
        {
          extensionId: 'ext1',
          name: 'Extension A',
          type: 'service_worker',
          url: 'chrome-extension://ext1/sw.js',
          targetId: 't1',
        },
        {
          extensionId: 'ext2',
          name: 'Extension B',
          type: 'background_page',
          url: 'chrome-extension://ext2/bg.html',
          targetId: 't2',
        },
      ]);

      const body = parseJson<unknown[]>(await handlers.handleExtensionListInstalled({}));
      expect(body).toHaveLength(2);
      // @ts-expect-error — auto-suppressed [TS2571]
      expect(body[0].extensionId).toBe('ext1');
      // @ts-expect-error — auto-suppressed [TS2571]
      expect(body[1].extensionId).toBe('ext2');
      // @ts-expect-error — auto-suppressed [TS2571]
      expect(body[0].name).toBe('Extension A');
    });

    it('handles error during listing', async () => {
      vi.spyOn(handlers, 'getExtensionTargets').mockRejectedValue(new Error('CDP error'));

      const body = parseJson<any>(await handlers.handleExtensionListInstalled({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('extension_list_installed');
      expect(body.error).toContain('CDP error');
    });

    it('always detaches session', async () => {
      vi.spyOn(handlers, 'getExtensionTargets').mockResolvedValue([]);

      await handlers.handleExtensionListInstalled({});
      expect(session.detach).toHaveBeenCalledOnce();
    });
  });

  // ── handleExtensionExecuteInContext ────────────────────────────────

  describe('handleExtensionExecuteInContext', () => {
    it('throws for missing extensionId', async () => {
      await expect(handlers.handleExtensionExecuteInContext({ code: '1+1' })).rejects.toThrow(
        'extensionId',
      );
    });

    it('throws for missing code', async () => {
      await expect(
        handlers.handleExtensionExecuteInContext({ extensionId: 'ext1' }),
      ).rejects.toThrow('code');
    });

    it('returns error when no target found for extension', async () => {
      vi.spyOn(handlers, 'getExtensionTargets').mockResolvedValue([]);

      const body = parseJson<any>(
        await handlers.handleExtensionExecuteInContext({
          extensionId: 'missing_ext',
          code: '1+1',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('No background target found');
    });

    it('executes code and returns result', async () => {
      vi.spyOn(handlers, 'getExtensionTargets').mockResolvedValue([
        { extensionId: 'ext1', name: 'A', type: 'service_worker', url: 'sw.js', targetId: 'tid' },
      ]);
      session.send.mockResolvedValue({ sessionId: 'attached-sid' });
      attachedSession.send.mockResolvedValue({ result: { value: 42 } });

      const body = parseJson<any>(
        await handlers.handleExtensionExecuteInContext({
          extensionId: 'ext1',
          code: '21 * 2',
        }),
      );

      expect(body.extensionId).toBe('ext1');
      expect(body.result).toBe(42);
      expect(body.target.type).toBe('service_worker');
      expect(attachedSession.send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: '21 * 2',
        returnByValue: true,
        awaitPromise: true,
      });
      expect(session.send).toHaveBeenCalledWith('Target.detachFromTarget', {
        sessionId: 'attached-sid',
      });
      expect(attachedSession.detach).not.toHaveBeenCalled();
    });
  });
});

class TestSourcemapToolHandlersMain extends SourcemapToolHandlersMain {
  public override delay(ms: number) {
    return super.delay(ms);
  }
  public override async parseSourceMap(sourceMapUrl: string, scriptUrl?: string) {
    return super.parseSourceMap(sourceMapUrl, scriptUrl);
  }
  public override async parseSourceMapStats(sourceMapUrl: string, scriptUrl?: string) {
    return super.parseSourceMapStats(sourceMapUrl, scriptUrl);
  }
}

describe('SourcemapToolHandlersMain', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = createPageMock({
    // @ts-expect-error — auto-suppressed [TS2353]
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  });
  const collector = {
    getActivePage: vi.fn(async () => page),
  };

  let handlers: TestSourcemapToolHandlersMain;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestSourcemapToolHandlersMain(collector as any);
  });

  // ── handleSourcemapDiscover ────────────────────────────────────────

  describe('handleSourcemapDiscover', () => {
    it('returns discovered source maps from scripts', async () => {
      let parsedCallback: ((payload: any) => void) | null = null;
      session.on.mockImplementation((_event: string, cb: (payload: any) => void) => {
        parsedCallback = cb;
      });
      session.send.mockImplementation(async (method: string) => {
        if (method === 'Debugger.enable') {
          parsedCallback?.({
            scriptId: 's1',
            url: 'https://example.com/app.js',
            sourceMapURL: 'app.js.map',
          });
          return {};
        }
        if (method === 'Debugger.getScriptSource') {
          return { scriptSource: '' };
        }
        return {};
      });

      vi.spyOn(handlers, 'delay').mockResolvedValue(undefined);

      const body = parseJson<unknown[]>(await handlers.handleSourcemapDiscover({}));
      expect(Array.isArray(body)).toBe(true);
    });

    it('handles error during discover', async () => {
      session.on.mockImplementation(() => {});
      session.send.mockRejectedValue(new Error('Debugger unavailable'));

      const body = parseJson<any>(await handlers.handleSourcemapDiscover({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_discover');
    });

    it('always cleans up debugger and detaches session', async () => {
      session.on.mockImplementation(() => {});
      session.send.mockResolvedValue({});
      vi.spyOn(handlers, 'delay').mockResolvedValue(undefined);

      await handlers.handleSourcemapDiscover({});

      expect(session.off).toHaveBeenCalled();
      expect(session.detach).toHaveBeenCalled();
    });
  });

  // ── handleSourcemapFetchAndParse ───────────────────────────────────

  describe('handleSourcemapFetchAndParse', () => {
    it('throws when sourceMapUrl is missing', async () => {
      const body = parseJson<any>(await handlers.handleSourcemapFetchAndParse({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_fetch_and_parse');
    });

    it('returns parsed source map with sources and mappings', async () => {
      vi.spyOn(handlers, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          version: 3,
          sources: ['src/index.ts', 'src/utils.ts'],
          sourcesContent: ['const a = 1;', 'const b = 2;'],
          mappings: '',
          names: [],
        },
        mappings: [],
        mappingsCount: 10,
        segmentCount: 50,
      });

      const body = parseJson<any>(
        await handlers.handleSourcemapFetchAndParse({
          sourceMapUrl: 'https://example.com/app.js.map',
        }),
      );

      expect(body.sources).toEqual(['src/index.ts', 'src/utils.ts']);
      expect(body.mappingsCount).toBe(10);
      expect(body.segmentCount).toBe(50);
      expect(body.sourcesContent).toEqual(['const a = 1;', 'const b = 2;']);
    });

    it('omits sourcesContent when not in map', async () => {
      vi.spyOn(handlers, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          version: 3,
          sources: ['src/index.ts'],
          mappings: '',
          names: [],
        },
        mappings: [],
        mappingsCount: 5,
        segmentCount: 20,
      });

      const body = parseJson<any>(
        await handlers.handleSourcemapFetchAndParse({
          sourceMapUrl: 'https://example.com/app.js.map',
        }),
      );

      expect(body.sources).toEqual(['src/index.ts']);
      expect(body.sourcesContent).toBeUndefined();
    });

    it('handles parseSourceMap error', async () => {
      vi.spyOn(handlers, 'parseSourceMap').mockRejectedValue(new Error('Invalid SourceMap JSON'));

      const body = parseJson<any>(
        await handlers.handleSourcemapFetchAndParse({ sourceMapUrl: 'https://bad.com/map' }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid SourceMap JSON');
    });

    it('passes scriptUrl to parseSourceMap when provided', async () => {
      const spy = vi.spyOn(handlers, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'url',
        map: { version: 3, sources: [], mappings: '', names: [] },
        mappings: [],
        mappingsCount: 0,
        segmentCount: 0,
      });

      await handlers.handleSourcemapFetchAndParse({
        sourceMapUrl: 'app.js.map',
        scriptUrl: 'https://example.com/app.js',
      });

      expect(spy).toHaveBeenCalledWith('app.js.map', 'https://example.com/app.js');
    });
  });

  // ── handleSourcemapReconstructTree ─────────────────────────────────

  describe('handleSourcemapReconstructTree', () => {
    it('throws when sourceMapUrl is missing', async () => {
      const body = parseJson<any>(await handlers.handleSourcemapReconstructTree({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_reconstruct_tree');
    });

    it('reconstructs file tree from source map', async () => {
      vi.spyOn(handlers, 'parseSourceMapStats').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          version: 3,
          sources: ['src/index.ts', 'src/utils.ts'],
          sourcesContent: ['const a = 1;', 'const b = 2;'],
          mappings: '',
          names: [],
        },
        mappingsCount: 10,
        segmentCount: 50,
      });

      const body = parseJson<any>(
        await handlers.handleSourcemapReconstructTree({
          sourceMapUrl: 'https://example.com/app.js.map',
        }),
      );

      expect(body.totalSources).toBe(2);
      expect(body.writtenFiles).toBe(2);
      expect(body.skippedFiles).toBe(0);
      expect(body.files).toContain('src/index.ts');
      expect(body.files).toContain('src/utils.ts');
    });

    it('handles missing sourcesContent gracefully', async () => {
      vi.spyOn(handlers, 'parseSourceMapStats').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          version: 3,
          sources: ['src/main.js'],
          mappings: '',
          names: [],
        },
        mappingsCount: 5,
        segmentCount: 20,
      });

      const body = parseJson<any>(
        await handlers.handleSourcemapReconstructTree({
          sourceMapUrl: 'https://example.com/app.js.map',
        }),
      );

      expect(body.totalSources).toBe(1);
      expect(body.writtenFiles).toBe(1);
    });

    it('handles parseSourceMap error in reconstruct', async () => {
      vi.spyOn(handlers, 'parseSourceMapStats').mockRejectedValue(new Error('Failed fetch'));

      const body = parseJson<any>(
        await handlers.handleSourcemapReconstructTree({ sourceMapUrl: 'bad' }),
      );

      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_reconstruct_tree');
    });
  });
});
