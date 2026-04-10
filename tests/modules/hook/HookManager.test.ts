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

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/hook/HookGenerator', () => ({
  generateHookScript: hookGenState.generateHookScript,
  getInjectionInstructions: hookGenState.getInjectionInstructions,
  generateAntiDebugBypass: hookGenState.generateAntiDebugBypass,
  generateHookTemplate: hookGenState.generateHookTemplate,
  generateHookChain: hookGenState.generateHookChain,
}));

import { HookManager } from '@modules/hook/HookManager';

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
      { target: 'b', type: 'function' as unknown },
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

  it('returns empty array for getHookRecords when hook has no records', () => {
    const manager = new HookManager();
    expect(manager.getHookRecords('nonexistent')).toEqual([]);
  });

  it('clears all records when clearHookRecords is called without hookId', async () => {
    const manager = new HookManager();
    const a = await manager.createHook({ target: 'a', type: 'function' } as any);
    const b = await manager.createHook({ target: 'b', type: 'function' } as any);
    manager.recordHookEvent(a.hookId, { args: [1] } as any);
    manager.recordHookEvent(b.hookId, { args: [2] } as any);

    manager.clearHookRecords();

    expect(manager.getHookRecords(a.hookId)).toHaveLength(0);
    expect(manager.getHookRecords(b.hookId)).toHaveLength(0);
  });

  it('logs warn when enabling/disabling a non-existent hook', () => {
    const manager = new HookManager();
    manager.enableHook('ghost-hook');
    manager.disableHook('ghost-hook');
    expect(loggerState.warn).toHaveBeenCalledWith('Hook not found: ghost-hook');
  });

  it('returns null for getHookStats of non-existent hook', async () => {
    const manager = new HookManager();
    expect(manager.getHookStats('ghost')).toBeNull();
  });

  it('exports all hook data when no hookId is provided', async () => {
    const manager = new HookManager();
    const a = await manager.createHook({ target: 'a', type: 'function' } as any);
    const b = await manager.createHook({ target: 'b', type: 'function' } as any);
    manager.recordHookEvent(a.hookId, { foo: 1 } as any);
    manager.recordHookEvent(b.hookId, { foo: 2 } as any);

    const all = manager.exportHookData();

    expect(all.metadata).toHaveLength(2);
    expect(all.scripts[a.hookId]).toBeTruthy();
    expect(all.scripts[b.hookId]).toBeTruthy();
    expect(all.records[a.hookId]).toHaveLength(1);
    expect(all.records[b.hookId]).toHaveLength(1);
  });

  it('returns empty exports for non-existent hook', () => {
    const manager = new HookManager();
    const result = manager.exportHookData('ghost');
    expect(result.metadata).toHaveLength(0);
    expect(result.scripts['ghost']).toBe('');
    expect(result.records['ghost']).toHaveLength(0);
  });

  it('deletes hook data from all maps', async () => {
    const manager = new HookManager();
    const { hookId } = await manager.createHook({ target: 'x', type: 'function' } as any);
    expect(manager.getAllHooks()).toContain(hookId);

    manager.deleteHook(hookId);
    expect(manager.getAllHooks()).not.toContain(hookId);
    expect(manager.getHookMetadata(hookId)).toBeUndefined();
    expect(manager.getHookRecords(hookId)).toEqual([]);
  });

  it('handles deleteHook for non-existent hook gracefully', () => {
    const manager = new HookManager();
    manager.deleteHook('ghost');
    expect(manager.getAllHooks()).toHaveLength(0);
  });

  it('covers error path in createHook', async () => {
    const manager = new HookManager();
    hookGenState.generateHookScript.mockImplementationOnce(() => {
      throw new Error('generation failed');
    });
    await expect(manager.createHook({ target: 'x', type: 'function' } as any)).rejects.toThrow(
      'generation failed',
    );
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('triggers MAX_HOOK_RECORDS limit and oldest-record removal', async () => {
    const manager = new HookManager() as any;
    manager.MAX_HOOK_RECORDS = 3;
    manager.MAX_TOTAL_RECORDS = 1000;

    const { hookId } = await manager.createHook({ target: 'x', type: 'function' });

    for (let i = 0; i < 5; i++) {
      manager.recordHookCall(hookId, { hookId, timestamp: i, context: { n: i } });
    }

    expect(manager.getHookRecords(hookId).length).toBeLessThanOrEqual(3);
  });

  it('triggers cleanupOldestRecords via MAX_TOTAL_RECORDS', async () => {
    const manager = new HookManager() as any;
    manager.MAX_HOOK_RECORDS = 100;
    manager.MAX_TOTAL_RECORDS = 4;

    const h1 = await manager.createHook({ target: 'h1', type: 'function' });
    const h2 = await manager.createHook({ target: 'h2', type: 'function' });

    // totalRecords > MAX_TOTAL_RECORDS (strictly greater)
    for (let i = 0; i < 2; i++) {
      manager.recordHookCall(h1.hookId, { hookId: h1.hookId, timestamp: i, context: {} });
    }
    for (let i = 2; i < 5; i++) {
      manager.recordHookCall(h2.hookId, { hookId: h2.hookId, timestamp: i, context: {} });
    }

    expect(loggerState.warn).toHaveBeenCalled();
  });

  it('handles recordHookCall with non-existent hook', () => {
    const manager = new HookManager();
    // @ts-expect-error
    manager.recordHookCall('ghost', { hookId: 'ghost', timestamp: 1, context: {} });
    expect(manager.getHookRecords('ghost')).toHaveLength(1);
    // no metadata was created (no createHook), so stats return null
    expect(manager.getHookStats('ghost')).toBeNull();
  });

  it('exposes getAllHookMetadata and getAllHooks', async () => {
    const manager = new HookManager();
    const a = await manager.createHook({ target: 'a', type: 'function' } as any);
    const b = await manager.createHook({ target: 'b', type: 'function' } as any);

    expect(manager.getAllHooks()).toEqual(expect.arrayContaining([a.hookId, b.hookId]));
    expect(manager.getAllHookMetadata()).toHaveLength(2);
  });

  it('computes getHookRecordsStats correctly', async () => {
    const manager = new HookManager();
    const { hookId } = await manager.createHook({ target: 'x', type: 'function' } as any);
    manager.recordHookEvent(hookId, { args: [1] } as any);
    manager.recordHookEvent(hookId, { args: [2] } as any);

    const stats = manager.getHookRecordsStats();
    expect(stats.totalHooks).toBe(1);
    expect(stats.totalRecords).toBe(2);
    expect(stats.recordsByHook[hookId]).toBe(2);
    expect(stats.oldestRecord).not.toBeNull();
    expect(stats.newestRecord).not.toBeNull();
  });

  it('handles createBatchHooks when all targets fail', async () => {
    const manager = new HookManager();
    const createSpy = vi.spyOn(manager, 'createHook');
    createSpy.mockRejectedValue(new Error('always fails'));

    const results = await manager.createBatchHooks([
      { target: 'a', type: 'function' as any },
      { target: 'b', type: 'function' as any },
    ]);

    expect(results).toHaveLength(0);
  });

  it('returns correct avgExecutionTime in getHookStats', async () => {
    const manager = new HookManager();
    const { hookId } = await manager.createHook({ target: 'x', type: 'function' } as any);
    // @ts-expect-error
    manager.recordHookCall(hookId, { hookId, timestamp: 1, context: {} });
    // @ts-expect-error
    manager.recordHookCall(hookId, { hookId, timestamp: 2, context: {} });

    const stats = manager.getHookStats(hookId);
    expect(stats?.callCount).toBe(2);
    expect(stats?.avgExecutionTime).toBeGreaterThanOrEqual(0);
  });
});
