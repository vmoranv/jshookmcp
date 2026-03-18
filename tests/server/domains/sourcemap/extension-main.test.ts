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

import { SourcemapToolHandlersMain } from '@server/domains/sourcemap/handlers.impl.sourcemap-main';
import { SourcemapToolHandlersExtension } from '@server/domains/sourcemap/handlers.impl.sourcemap-extension';
import type { ExtensionTarget } from '@server/domains/sourcemap/handlers.impl.sourcemap-parse-base';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('SourcemapToolHandlersExtension', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = {
    createCDPSession: vi.fn(async () => session),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: SourcemapToolHandlersExtension;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new SourcemapToolHandlersExtension(collector);
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

      const targets = await (handlers as any).getExtensionTargets(session);
      expect(targets).toHaveLength(2);
      expect(targets[0].type).toBe('service_worker');
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

      const targets = await (handlers as any).getExtensionTargets(session);
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

      const targets = await (handlers as any).getExtensionTargets(
        session,
        'ponmlkjihgfedcbaponmlkjihgfedcba'
      );
      expect(targets).toHaveLength(1);
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

      const targets = await (handlers as any).getExtensionTargets(session);
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

      const targets = await (handlers as any).getExtensionTargets(session);
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

      const targets = await (handlers as any).getExtensionTargets(session);
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

      const targets = await (handlers as any).getExtensionTargets(session);
      expect(targets[0].type).toBe('service_worker');
      expect(targets[1].type).toBe('background_page');
    });

    it('handles empty targetInfos array', async () => {
      session.send.mockResolvedValueOnce({ targetInfos: [] });

      const targets = await (handlers as any).getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });

    it('handles missing targetInfos in response', async () => {
      session.send.mockResolvedValueOnce({});

      const targets = await (handlers as any).getExtensionTargets(session);
      expect(targets).toHaveLength(0);
    });
  });

  // ── pickPreferredExtensionTarget ───────────────────────────────────

  describe('pickPreferredExtensionTarget', () => {
    it('prefers service_worker over background_page', () => {
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

      const result = (handlers as any).pickPreferredExtensionTarget(targets);
      expect(result.type).toBe('service_worker');
    });

    it('falls back to first target if no service_worker', () => {
      const targets: ExtensionTarget[] = [
        {
          targetId: 't1',
          extensionId: 'ext1',
          name: 'BG',
          type: 'background_page',
          url: 'bg.html',
        },
      ];

      const result = (handlers as any).pickPreferredExtensionTarget(targets);
      expect(result.type).toBe('background_page');
    });
  });

  // ── extractExtensionId ─────────────────────────────────────────────

  describe('extractExtensionId', () => {
    it('extracts ID from valid chrome-extension URL', () => {
      const id = (handlers as any).extractExtensionId(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sw.js'
      );
      expect(id).toBe('abcdefghijklmnopabcdefghijklmnop');
    });

    it('returns null for non-chrome-extension URL', () => {
      const id = (handlers as any).extractExtensionId('https://example.com/sw.js');
      expect(id).toBeNull();
    });

    it('returns null for invalid extension ID format', () => {
      const id = (handlers as any).extractExtensionId('chrome-extension://short/sw.js');
      expect(id).toBeNull();
    });

    it('handles URL with no path after extension ID', () => {
      const id = (handlers as any).extractExtensionId(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
      );
      expect(id).toBe('abcdefghijklmnopabcdefghijklmnop');
    });
  });

  // ── evaluateInAttachedTarget ───────────────────────────────────────

  describe('evaluateInAttachedTarget', () => {
    it('throws when session does not support event listeners', async () => {
      const sessionNoEvents = {
        send: vi.fn(),
      };

      await expect(
        (handlers as any).evaluateInAttachedTarget(sessionNoEvents, 'sid', 'code', true)
      ).rejects.toThrow('CDP session does not support event listeners');
    });

    it('throws when Target.sendMessageToTarget fails', async () => {
      const sessionWithEvents = {
        send: vi.fn(async (method: string) => {
          if (method === 'Target.sendMessageToTarget') {
            throw new Error('Send failed: session closed');
          }
        }),
        on: vi.fn(),
        off: vi.fn(),
      };

      await expect(
        (handlers as any).evaluateInAttachedTarget(sessionWithEvents, 'sid', '1+1', true)
      ).rejects.toThrow('Send failed: session closed');
    });
  });

  // ── handleExtensionListInstalled ───────────────────────────────────

  describe('handleExtensionListInstalled', () => {
    it('returns list of installed extensions', async () => {
      vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
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

      const body = parseJson(await handlers.handleExtensionListInstalled({}));
      expect(body).toHaveLength(2);
      expect(body[0].extensionId).toBe('ext1');
      expect(body[1].extensionId).toBe('ext2');
      expect(body[0].name).toBe('Extension A');
    });

    it('handles error during listing', async () => {
      vi.spyOn(handlers as any, 'getExtensionTargets').mockRejectedValue(new Error('CDP error'));

      const body = parseJson(await handlers.handleExtensionListInstalled({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('extension_list_installed');
      expect(body.error).toContain('CDP error');
    });

    it('always detaches session', async () => {
      vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([]);

      await handlers.handleExtensionListInstalled({});
      expect(session.detach).toHaveBeenCalledOnce();
    });
  });

  // ── handleExtensionExecuteInContext ────────────────────────────────

  describe('handleExtensionExecuteInContext', () => {
    it('throws for missing extensionId', async () => {
      await expect(handlers.handleExtensionExecuteInContext({ code: '1+1' })).rejects.toThrow(
        'extensionId'
      );
    });

    it('throws for missing code', async () => {
      await expect(
        handlers.handleExtensionExecuteInContext({ extensionId: 'ext1' })
      ).rejects.toThrow('code');
    });

    it('returns error when no target found for extension', async () => {
      vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([]);

      const body = parseJson(
        await handlers.handleExtensionExecuteInContext({
          extensionId: 'missing_ext',
          code: '1+1',
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('No background target found');
    });

    it('executes code and returns result', async () => {
      vi.spyOn(handlers as any, 'getExtensionTargets').mockResolvedValue([
        { extensionId: 'ext1', name: 'A', type: 'service_worker', url: 'sw.js', targetId: 'tid' },
      ]);
      vi.spyOn(handlers as any, 'evaluateInAttachedTarget').mockResolvedValue({
        result: { type: 'number', value: 42 },
        exceptionDetails: null,
      });
      session.send.mockResolvedValue({ sessionId: 'attached-sid' });

      const body = parseJson(
        await handlers.handleExtensionExecuteInContext({
          extensionId: 'ext1',
          code: '21 * 2',
        })
      );

      expect(body.extensionId).toBe('ext1');
      expect(body.result).toEqual({ type: 'number', value: 42 });
      expect(body.target.type).toBe('service_worker');
    });
  });
});

describe('SourcemapToolHandlersMain', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: SourcemapToolHandlersMain;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new SourcemapToolHandlersMain(collector);
  });

  // ── handleSourcemapDiscover ────────────────────────────────────────

  describe('handleSourcemapDiscover', () => {
    it('returns discovered source maps from scripts', async () => {
      let parsedCallback: ((payload: unknown) => void) | null = null;
      session.on.mockImplementation((_event: string, cb: (payload: unknown) => void) => {
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

      vi.spyOn(handlers as any, 'delay').mockResolvedValue(undefined);

      const body = parseJson(await handlers.handleSourcemapDiscover({}));
      expect(Array.isArray(body)).toBe(true);
    });

    it('handles error during discover', async () => {
      session.on.mockImplementation(() => {});
      session.send.mockRejectedValue(new Error('Debugger unavailable'));

      const body = parseJson(await handlers.handleSourcemapDiscover({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_discover');
    });

    it('always cleans up debugger and detaches session', async () => {
      session.on.mockImplementation(() => {});
      session.send.mockResolvedValue({});
      vi.spyOn(handlers as any, 'delay').mockResolvedValue(undefined);

      await handlers.handleSourcemapDiscover({});

      expect(session.off).toHaveBeenCalled();
      expect(session.detach).toHaveBeenCalled();
    });
  });

  // ── handleSourcemapFetchAndParse ───────────────────────────────────

  describe('handleSourcemapFetchAndParse', () => {
    it('throws when sourceMapUrl is missing', async () => {
      const body = parseJson(await handlers.handleSourcemapFetchAndParse({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_fetch_and_parse');
    });

    it('returns parsed source map with sources and mappings', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          sources: ['src/index.ts', 'src/utils.ts'],
          sourcesContent: ['const a = 1;', 'const b = 2;'],
        },
        mappingsCount: 10,
        segmentCount: 50,
      });

      const body = parseJson(
        await handlers.handleSourcemapFetchAndParse({
          sourceMapUrl: 'https://example.com/app.js.map',
        })
      );

      expect(body.sources).toEqual(['src/index.ts', 'src/utils.ts']);
      expect(body.mappingsCount).toBe(10);
      expect(body.segmentCount).toBe(50);
      expect(body.sourcesContent).toEqual(['const a = 1;', 'const b = 2;']);
    });

    it('omits sourcesContent when not in map', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          sources: ['src/index.ts'],
        },
        mappingsCount: 5,
        segmentCount: 20,
      });

      const body = parseJson(
        await handlers.handleSourcemapFetchAndParse({
          sourceMapUrl: 'https://example.com/app.js.map',
        })
      );

      expect(body.sources).toEqual(['src/index.ts']);
      expect(body.sourcesContent).toBeUndefined();
    });

    it('handles parseSourceMap error', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockRejectedValue(
        new Error('Invalid SourceMap JSON')
      );

      const body = parseJson(
        await handlers.handleSourcemapFetchAndParse({ sourceMapUrl: 'https://bad.com/map' })
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid SourceMap JSON');
    });

    it('passes scriptUrl to parseSourceMap when provided', async () => {
      const spy = vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'url',
        map: { sources: [] },
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
      const body = parseJson(await handlers.handleSourcemapReconstructTree({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_reconstruct_tree');
    });

    it('reconstructs file tree from source map', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          sources: ['src/index.ts', 'src/utils.ts'],
          sourcesContent: ['const a = 1;', 'const b = 2;'],
        },
        mappingsCount: 10,
        segmentCount: 50,
      });

      const body = parseJson(
        await handlers.handleSourcemapReconstructTree({
          sourceMapUrl: 'https://example.com/app.js.map',
        })
      );

      expect(body.totalSources).toBe(2);
      expect(body.writtenFiles).toBe(2);
      expect(body.skippedFiles).toBe(0);
      expect(body.files).toContain('src/index.ts');
      expect(body.files).toContain('src/utils.ts');
    });

    it('handles missing sourcesContent gracefully', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockResolvedValue({
        resolvedUrl: 'https://example.com/app.js.map',
        map: {
          sources: ['src/main.js'],
        },
        mappingsCount: 5,
        segmentCount: 20,
      });

      const body = parseJson(
        await handlers.handleSourcemapReconstructTree({
          sourceMapUrl: 'https://example.com/app.js.map',
        })
      );

      expect(body.totalSources).toBe(1);
      expect(body.writtenFiles).toBe(1);
    });

    it('handles parseSourceMap error in reconstruct', async () => {
      vi.spyOn(handlers as any, 'parseSourceMap').mockRejectedValue(new Error('Failed fetch'));

      const body = parseJson(
        await handlers.handleSourcemapReconstructTree({ sourceMapUrl: 'bad' })
      );

      expect(body.success).toBe(false);
      expect(body.tool).toBe('sourcemap_reconstruct_tree');
    });
  });
});
