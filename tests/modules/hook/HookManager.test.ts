import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const hookGenState = vi.hoisted(() => ({
  generateHookScript: vi.fn(() => '/*hook*/'),
  getInjectionInstructions: vi.fn(() => 'inject'),
  generateAntiDebugBypass: vi.fn(() => 'bypass-code'),
  generateHookTemplate: vi.fn(() => 'template-code'),
  generateHookChain: vi.fn(() => 'chain-code'),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/modules/hook/HookGenerator.js', () => ({
  generateHookScript: hookGenState.generateHookScript,
  getInjectionInstructions: hookGenState.getInjectionInstructions,
  generateAntiDebugBypass: hookGenState.generateAntiDebugBypass,
  generateHookTemplate: hookGenState.generateHookTemplate,
  generateHookChain: hookGenState.generateHookChain,
}));

import { HookManager } from '../../../src/modules/hook/HookManager.js';

describe('HookManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    Object.values(hookGenState).forEach((fn) => (fn as any).mockReset?.());
    hookGenState.generateHookScript.mockReturnValue('/*hook*/');
    hookGenState.getInjectionInstructions.mockReturnValue('inject');
    hookGenState.generateAntiDebugBypass.mockReturnValue('bypass-code');
    hookGenState.generateHookTemplate.mockReturnValue('template-code');
    hookGenState.generateHookChain.mockReturnValue('chain-code');
  });

  it('creates hook script and metadata entries', async () => {
    const manager = new HookManager();
    const result = await manager.createHook({
      target: 'window.fetch',
      type: 'function',
      action: 'log',
      condition: { maxCalls: 5 },
    } as any);

    expect(result.script).toBe('/*hook*/');
    expect(result.instructions).toBe('inject');
    expect(manager.getAllHooks()).toContain(result.hookId);
    expect(manager.getHookMetadata(result.hookId)?.enabled).toBe(true);
  });

  it('records hook events and supports clear operations', async () => {
    const manager = new HookManager();
    const { hookId } = await manager.createHook({ target: 'x', type: 'function' } as any);

    manager.recordHookEvent(hookId, { args: [1] } as any);
    manager.recordHookEvent(hookId, { args: [2] } as any);
    expect(manager.getHookRecords(hookId)).toHaveLength(2);

    manager.clearHookRecords(hookId);
    expect(manager.getHookRecords(hookId)).toHaveLength(0);
  });

  it('toggles hook enabled state and exposes stats', async () => {
    const manager = new HookManager();
    const { hookId } = await manager.createHook({ target: 'x', type: 'function' } as any);

    manager.disableHook(hookId);
    expect(manager.getHookStats(hookId)?.enabled).toBe(false);
    manager.enableHook(hookId);
    expect(manager.getHookStats(hookId)?.enabled).toBe(true);
  });

  it('exports single/all hook payloads', async () => {
    const manager = new HookManager();
    const a = await manager.createHook({ target: 'a', type: 'function' } as any);
    const b = await manager.createHook({ target: 'b', type: 'function' } as any);
    manager.recordHookEvent(a.hookId, { foo: 1 } as any);

    const single = manager.exportHookData(a.hookId);
    const all = manager.exportHookData();

    expect(single.metadata).toHaveLength(1);
    expect(single.records[a.hookId]).toHaveLength(1);
    expect(Object.keys(all.scripts)).toEqual(expect.arrayContaining([a.hookId, b.hookId]));
  });

  it('enforces record limits and performs oldest-record cleanup', async () => {
    const manager = new HookManager() as any;
    manager.MAX_HOOK_RECORDS = 2;
    manager.MAX_TOTAL_RECORDS = 3;

    const h1 = await manager.createHook({ target: 'h1', type: 'function' });
    const h2 = await manager.createHook({ target: 'h2', type: 'function' });

    manager.recordHookCall(h1.hookId, { hookId: h1.hookId, timestamp: 1, context: {} });
    manager.recordHookCall(h1.hookId, { hookId: h1.hookId, timestamp: 2, context: {} });
    manager.recordHookCall(h1.hookId, { hookId: h1.hookId, timestamp: 3, context: {} });
    manager.recordHookCall(h2.hookId, { hookId: h2.hookId, timestamp: 4, context: {} });

    expect(manager.getHookRecords(h1.hookId).length).toBeLessThanOrEqual(2);
    const stats = manager.getHookRecordsStats();
    expect(stats.totalRecords).toBeLessThanOrEqual(3);
  });

  it('continues batch hook creation when one target fails', async () => {
    const manager = new HookManager();
    const createSpy = vi.spyOn(manager, 'createHook');
    createSpy
      .mockResolvedValueOnce({ hookId: 'ok-1', script: 's1', instructions: 'i1' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ hookId: 'ok-2', script: 's2', instructions: 'i2' });

    const results = await manager.createBatchHooks([
      { target: 'a', type: 'function' as any },
      { target: 'b', type: 'function' as any },
      { target: 'c', type: 'function' as any },
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.hookId)).toEqual(['ok-1', 'ok-2']);
  });

  it('delegates helper generation methods to HookGenerator functions', () => {
    const manager = new HookManager();

    expect(manager.generateAntiDebugBypass()).toBe('bypass-code');
    expect(manager.generateHookTemplate('x', 'function')).toBe('template-code');
    expect(manager.generateHookChain([] as any)).toBe('chain-code');
  });
});

