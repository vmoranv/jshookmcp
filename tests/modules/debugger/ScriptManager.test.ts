import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ScriptManager } from '../../../src/modules/debugger/ScriptManager.js';

function createSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const send = vi.fn(async (method: string, params?: any) => {
    if (method === 'Debugger.getScriptSource') {
      return {
        scriptSource:
          `function hello(){ const token = "abc"; }\n` +
          `const api = fetch('/api');\n` +
          `export default hello;`,
      };
    }
    if (method === 'Debugger.enable' || method === 'Debugger.disable') {
      return {};
    }
    return { params };
  });
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const group = listeners.get(event) ?? new Set();
    group.add(handler);
    listeners.set(event, group);
  });
  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return {
    session: {
      send,
      on,
      off: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
    } as any,
    send,
    emit,
  };
}

describe('ScriptManager', () => {
  let manager: ScriptManager;
  let cdp: ReturnType<typeof createSession>;

  beforeEach(async () => {
    cdp = createSession();
    const page = { createCDPSession: vi.fn().mockResolvedValue(cdp.session) };
    const collector = { getActivePage: vi.fn().mockResolvedValue(page) };
    manager = new ScriptManager(collector as any);
    await manager.init();
  });

  it('captures scriptParsed events and stores script metadata', async () => {
    cdp.emit('Debugger.scriptParsed', {
      scriptId: '1',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 10,
      endColumn: 0,
      length: 120,
    });

    const scripts = await manager.getAllScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.scriptId).toBe('1');
  });

  it('loads script source by scriptId and exposes chunk access', async () => {
    cdp.emit('Debugger.scriptParsed', {
      scriptId: '1',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 10,
      endColumn: 0,
      length: 120,
    });

    const script = await manager.getScriptSource('1');
    expect(script?.source).toContain('function hello');
    expect(manager.getScriptChunk('1', 0)).toContain('token');
  });

  it('finds scripts by wildcard URL patterns', async () => {
    cdp.emit('Debugger.scriptParsed', {
      scriptId: 'a',
      url: 'https://site/vendor.bundle.js',
      startLine: 0,
      startColumn: 0,
      endLine: 1,
      endColumn: 0,
      length: 10,
    });
    cdp.emit('Debugger.scriptParsed', {
      scriptId: 'b',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 1,
      endColumn: 0,
      length: 10,
    });

    const found = await manager.findScriptsByUrl('*vendor*');
    expect(found).toHaveLength(1);
    expect(found[0]?.scriptId).toBe('a');
  });

  it('searches loaded script sources and returns contextual matches', async () => {
    cdp.emit('Debugger.scriptParsed', {
      scriptId: '1',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 10,
      endColumn: 0,
      length: 120,
    });
    await manager.getScriptSource('1');

    const result = await manager.searchInScripts('token', { contextLines: 1 });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches[0]?.context).toContain('token');
  });

  it('searchInScriptsEnhanced uses indexed lookup for non-regex queries', async () => {
    cdp.emit('Debugger.scriptParsed', {
      scriptId: '1',
      url: 'https://site/app.js',
      startLine: 0,
      startColumn: 0,
      endLine: 10,
      endColumn: 0,
      length: 120,
    });
    await manager.getScriptSource('1');

    const result = await manager.searchInScriptsEnhanced('token');
    expect(result.searchMethod).toBe('indexed');
    expect(result.totalMatches).toBeGreaterThan(0);
  });
});

