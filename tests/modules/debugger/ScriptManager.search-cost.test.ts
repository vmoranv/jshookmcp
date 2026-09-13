import { describe, expect, it, vi } from 'vitest';
import { ScriptManager } from '@modules/debugger/ScriptManager.impl.class';

async function fixture(sources: string[]) {
  let parsed: (event: unknown) => void;
  const send = vi.fn(async (method: string, args?: { scriptId: string }) => {
    if (method === 'Debugger.enable') {
      sources.forEach((source, index) =>
        parsed({
          scriptId: String(index),
          url: '',
          startLine: 0,
          startColumn: 0,
          endLine: 0,
          endColumn: source.length,
          length: source.length,
        }),
      );
    }
    return { scriptSource: sources[Number(args?.scriptId)] };
  });
  const manager = new ScriptManager({
    getActivePage: async () => ({
      createCDPSession: async () => ({
        send,
        on: (_: string, listener: typeof parsed) => {
          parsed = listener;
        },
      }),
    }),
  } as never);
  await manager.init();
  return { manager, send };
}

describe('script search work bounds', () => {
  it('shares lazy indexing across concurrent enhanced searches', async () => {
    const { manager } = await fixture(['needle '.repeat(1000)]);
    await manager.getScriptSource('0');
    const [first, second] = await Promise.all([
      manager.searchInScriptsEnhanced('needle', { maxMatches: 2000 }),
      manager.searchInScriptsEnhanced('needle', { maxMatches: 2000 }),
    ]);
    expect(first.matches).toHaveLength(1000);
    expect(second).toEqual(first);
  });

  it('does not repopulate an index cleared while indexing yields', async () => {
    const { manager } = await fixture(['needle '.repeat(1000)]);
    await manager.getScriptSource('0');
    const indexing = manager.searchInScriptsEnhanced('needle');
    manager.clearCache();
    await indexing;
    expect(manager.getStats().indexedKeywords).toBe(0);
  });

  it('honors cancellation before touching the browser', async () => {
    const { manager, send } = await fixture(['needle']);
    send.mockClear();
    const controller = new AbortController();
    controller.abort(new Error('cancel search'));
    await expect(manager.searchInScripts('needle', { signal: controller.signal })).rejects.toThrow(
      'cancel search',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('yields within a dense single line so an active search can be cancelled', async () => {
    const { manager } = await fixture(['needle '.repeat(20_000)]);
    const controller = new AbortController();
    const task = manager.searchInScripts('needle', {
      maxMatches: 20_000,
      signal: controller.signal,
    });
    setImmediate(() => controller.abort(new Error('cancel running search')));
    await expect(task).rejects.toThrow('cancel running search');
  });

  it('checks the deadline after a source read before loading another script', async () => {
    const { manager, send } = await fixture(['needle', 'later']);
    send.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { scriptSource: 'needle' };
    });
    await expect(manager.searchInScripts('needle', { timeoutMs: 1 })).rejects.toThrow(
      'Script search execution timed out',
    );
    expect(
      send.mock.calls.filter(([method]) => method === 'Debugger.getScriptSource'),
    ).toHaveLength(1);
  });

  it('does not load later scripts after reaching the match limit', async () => {
    const { manager, send } = await fixture(['const needle = 1;', 'const later = 2;']);
    const result = await manager.searchInScripts('needle', { maxMatches: 1 });
    expect(result.matches).toHaveLength(1);
    expect(send.mock.calls.filter(([method]) => method === 'Debugger.getScriptSource')).toEqual([
      ['Debugger.getScriptSource', { scriptId: '0' }],
    ]);
  });

  it('reads source without indexing and builds the enhanced index only once', async () => {
    const { manager } = await fixture(['const needle = 1;']);
    await manager.getScriptSource('0');
    expect(manager.getStats().indexedKeywords).toBe(0);
    const first = await manager.searchInScriptsEnhanced('needle');
    expect(first.matches).toHaveLength(1);
    expect(await manager.searchInScriptsEnhanced('needle')).toEqual(first);
  });

  it('keeps bounded context and correct columns on a large single line', async () => {
    const prefix = 'x'.repeat(100_000);
    const { manager } = await fixture([prefix + ' needle ' + 'x'.repeat(100_000) + '\n']);
    const result = await manager.searchInScripts('needle', { maxMatches: 1 });
    expect(result.matches[0]!.column).toBe(prefix.length + 1);
    expect(result.matches[0]!.context).toContain('needle');
    expect(result.matches[0]!.context.length).toBeLessThan(2000);
  });
});
