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

import { WatchExpressionManager } from '../../../src/modules/debugger/WatchExpressionManager.js';

describe('WatchExpressionManager', () => {
  let runtimeInspector: any;
  let manager: WatchExpressionManager;

  beforeEach(() => {
    runtimeInspector = {
      evaluate: vi.fn(),
    };
    manager = new WatchExpressionManager(runtimeInspector);
  });

  it('adds and removes watch expressions', () => {
    const id = manager.addWatch('foo + bar', 'sum');

    expect(manager.getWatch(id)?.name).toBe('sum');
    expect(manager.removeWatch(id)).toBe(true);
    expect(manager.getWatch(id)).toBeUndefined();
  });

  it('toggles watch enabled state', () => {
    const id = manager.addWatch('count');
    expect(manager.setWatchEnabled(id, false)).toBe(true);
    expect(manager.getWatch(id)?.enabled).toBe(false);
  });

  it('evaluates watches and tracks value history on change', async () => {
    runtimeInspector.evaluate
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });

    const id = manager.addWatch('obj.n');
    const first = await manager.evaluateAll();
    const second = await manager.evaluateAll();

    expect(first[0]?.valueChanged).toBe(true);
    expect(second[0]?.valueChanged).toBe(true);
    expect(manager.getValueHistory(id)?.length).toBe(2);
  });

  it('returns timeout error result when evaluation exceeds timeout', async () => {
    runtimeInspector.evaluate.mockImplementation(() => new Promise(() => {}));
    manager.addWatch('slowExpr');

    const result = await manager.evaluateAll(undefined, 10);
    expect(result[0]?.error?.message).toContain('Evaluation timeout');
  });

  it('exports and imports watch definitions', () => {
    manager.addWatch('a + b', 'sum');
    const tokenWatch = manager.addWatch('token', 'token');
    manager.setWatchEnabled(tokenWatch, false);
    const exported = manager.exportWatches();

    const runtime2 = { evaluate: vi.fn() };
    const importedManager = new WatchExpressionManager(runtime2 as any);
    importedManager.importWatches(exported);

    expect(importedManager.getAllWatches()).toHaveLength(2);
    expect(importedManager.getAllWatches()[0]?.expression).toBe('a + b');
    expect(importedManager.getAllWatches()[1]?.enabled).toBe(false);
  });
});
