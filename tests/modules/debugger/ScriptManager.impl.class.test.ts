import { describe, it, expect, vi, beforeEach } from 'vitest';

const scriptClassMocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@utils/logger', () => ({
  logger: scriptClassMocks.logger,
}));

import { ScriptManager } from '@modules/debugger/ScriptManager.impl.class';

function createSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();

  const session = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === 'Debugger.enable' || method === 'Debugger.disable') {
        return {};
      }
      if (method === 'Debugger.getScriptSource') {
        return {
          scriptSource:
            `function hello(){ const token${params?.scriptId ?? ''} = "abc"; }\n` +
            `const api = fetch('/api/${params?.scriptId ?? '1'}');\n` +
            `export default hello;`,
        };
      }
      return {};
    }),
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    }),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
    emit(event: string, payload: any) {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };

  return { session, listeners };
}

function emitScriptParsed(
  session: ReturnType<typeof createSession>['session'],
  scriptId: string,
  url: string,
  length = 120
) {
  session.emit('Debugger.scriptParsed', {
    scriptId,
    url,
    startLine: 0,
    startColumn: 0,
    endLine: 3,
    endColumn: 0,
    length,
  });
}

describe('ScriptManager core class internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached script sources without reloading them', async () => {
    const cdp = createSession();
    const manager = new ScriptManager({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    } as never);

    await manager.init();
    const script = {
      scriptId: 'script-1',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 1,
      endColumn: 0,
      source: 'const cached = true;',
      sourceLength: 20,
    };

    const loaded = await (manager as any).loadScriptSourceInternal(script);

    expect(loaded).toBe(true);
    expect(cdp.session.send).toHaveBeenCalledTimes(1);
  });

  it('supports wildcard URL lookup and validates missing identifiers', async () => {
    const cdp = createSession();
    const manager = new ScriptManager({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    } as never);

    await manager.init();
    emitScriptParsed(cdp.session, 'script-1', 'https://site/app.js');

    await expect(manager.getScriptSource()).rejects.toThrow(
      'Either scriptId or url parameter must be provided'
    );

    const script = await manager.getScriptSource(undefined, '*app*');
    expect(script?.scriptId).toBe('script-1');
    expect(script?.source).toContain('function hello');
  });

  it('loads sources in batches of eight when includeSource=true', async () => {
    const cdp = createSession();
    const resolvers: Array<() => void> = [];
    cdp.session.send.mockImplementation((method: string, params?: any) => {
      if (method === 'Debugger.enable' || method === 'Debugger.disable') {
        return Promise.resolve({});
      }
      if (method === 'Debugger.getScriptSource') {
        return new Promise((resolve) => {
          resolvers.push(() =>
            resolve({
              scriptSource: `const script${params?.scriptId} = true;`,
            })
          );
        });
      }
      return Promise.resolve({});
    });

    const manager = new ScriptManager({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    } as never);

    await manager.init();
    for (let index = 1; index <= 9; index++) {
      emitScriptParsed(cdp.session, `script-${index}`, `https://site/${index}.js`, 20);
    }

    const loading = manager.getAllScripts(true, 9);
    await Promise.resolve();

    expect(
      cdp.session.send.mock.calls.filter(([method]) => method === 'Debugger.getScriptSource')
    ).toHaveLength(8);

    resolvers.splice(0, 8).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      cdp.session.send.mock.calls.filter(([method]) => method === 'Debugger.getScriptSource')
    ).toHaveLength(9);

    resolvers.splice(0).forEach((resolve) => resolve());
    const scripts = await loading;
    expect(scripts).toHaveLength(9);
    expect(scripts.every((script) => typeof script.source === 'string')).toBe(true);
  });

  it('searches scripts with regex options and honors max match limits', async () => {
    const cdp = createSession();
    const manager = new ScriptManager({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    } as never);

    await manager.init();
    emitScriptParsed(cdp.session, 'script-1', 'https://site/app.js');
    await manager.getScriptSource('script-1');

    const result = await manager.searchInScripts('token\\w+', {
      isRegex: true,
      contextLines: 0,
      maxMatches: 1,
    });

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0]?.matchText).toMatch(/^token/);
    expect(result.matches[0]?.context).not.toContain('\n');
  });

  it('clears in-memory script caches and resets close state even when CDP cleanup fails', async () => {
    const cdp = createSession();
    cdp.session.send.mockImplementation(async (method: string) => {
      if (method === 'Debugger.enable') {
        return {};
      }
      if (method === 'Debugger.disable') {
        throw new Error('disable failed');
      }
      if (method === 'Debugger.getScriptSource') {
        return { scriptSource: 'const token = "abc";' };
      }
      return {};
    });
    const manager = new ScriptManager({
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    } as never);

    await manager.init();
    emitScriptParsed(cdp.session, 'script-1', 'https://site/app.js');
    await manager.getScriptSource('script-1');

    expect(manager.getStats().totalScripts).toBe(1);

    manager.clear();
    expect(manager.getStats()).toEqual({
      totalScripts: 0,
      totalUrls: 0,
      indexedKeywords: 0,
      totalChunks: 0,
    });

    emitScriptParsed(cdp.session, 'script-2', 'https://site/app-2.js');
    await manager.close();

    expect(scriptClassMocks.logger.warn).toHaveBeenCalledWith(
      'Failed to close CDP session:',
      expect.any(Error)
    );
    expect((manager as any).initialized).toBe(false);
    expect((manager as any).cdpSession).toBeNull();
  });

  it('indexes keywords in lowercase and chunks scripts for later retrieval', () => {
    const manager = new ScriptManager({ getActivePage: vi.fn() } as never);
    (manager as any).CHUNK_SIZE = 5;

    (manager as any).buildKeywordIndex(
      'script-1',
      'https://site/app.js',
      'line1\nLine2 tokenValue\nline3\nline4\nline5'
    );
    (manager as any).chunkScript('script-1', 'abcdefghij');

    const keywordEntries = (manager as any).keywordIndex.get('tokenvalue');
    expect(keywordEntries).toHaveLength(1);
    expect(keywordEntries[0]).toMatchObject({
      scriptId: 'script-1',
      url: 'https://site/app.js',
      line: 2,
      column: 6,
    });
    expect(keywordEntries[0]?.context).toContain('line1');
    expect(keywordEntries[0]?.context).toContain('line5');

    expect(manager.getScriptChunk('script-1', 0)).toBe('abcde');
    expect(manager.getScriptChunk('script-1', 1)).toBe('fghij');
    expect(manager.getScriptChunk('script-1', 2)).toBeNull();
  });

  it('delegates regex enhanced search to the full script searcher', async () => {
    const manager = new ScriptManager({ getActivePage: vi.fn() } as never);
    const searchSpy = vi.spyOn(manager, 'searchInScripts').mockResolvedValue({
      keyword: 'tok.*',
      totalMatches: 1,
      matches: [
        {
          scriptId: 'script-1',
          url: 'https://site/app.js',
          line: 1,
          column: 0,
          matchText: 'token',
          context: 'token',
        },
      ],
    });

    const result = await manager.searchInScriptsEnhanced('tok.*', { isRegex: true });

    expect(searchSpy).toHaveBeenCalledWith('tok.*', { isRegex: true });
    expect(result.searchMethod).toBe('regex');
    expect(result.totalMatches).toBe(1);
  });
});
