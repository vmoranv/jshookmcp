import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from '@modules/external/ToolProbe';

const probeState = vi.hoisted(() => ({
  probeCommand: vi.fn(),
}));

vi.mock('@src/modules/external/ToolProbe', () => ({
  probeCommand: probeState.probeCommand,
}));

import { ToolRegistry, resetSharedProbeCacheForTesting } from '@modules/external/ToolRegistry';

function available(path = '/bin/tool', version = '1.0.0'): ProbeResult {
  return { available: true, path, version };
}

describe('ToolRegistry', () => {
  beforeEach(() => {
    probeState.probeCommand.mockReset();
    // probeAll() now caches process-wide; isolate each test from the previous
    // one's cached results so the call-count assertions stay meaningful.
    resetSharedProbeCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers additional specs on construction', () => {
    const registry = new ToolRegistry([
      {
        name: 'custom.tool' as any,
        command: 'custom',
        required: false,
        versionArgs: [],
        envAllowlist: [],
      },
    ]);
    expect(registry.isRegistered('custom.tool')).toBe(true);
  });

  it('contains default registered tools', () => {
    const registry = new ToolRegistry();
    const tools = registry.getRegisteredTools();

    expect(tools).toContain('wabt.wasm2wat');
    expect(tools).toContain('binaryen.wasm-opt');
    expect(tools).toContain('platform.jadx');
    expect(registry.isRegistered('runtime.wasmtime')).toBe(true);
  });

  it('throws when requesting unknown tool spec', () => {
    const registry = new ToolRegistry();
    expect(() => registry.getSpec('unknown.tool' as any)).toThrow('not registered');
  });

  it('registers tool at runtime and updates spec lookup', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'runtime.wasmer',
      command: 'wasmer-custom',
      required: false,
      versionArgs: ['--version'],
      envAllowlist: [],
    });

    expect(registry.getSpec('runtime.wasmer').command).toBe('wasmer-custom');
  });

  it('probes tools and reuses cache when not forced', async () => {
    probeState.probeCommand.mockResolvedValue(available());
    const registry = new ToolRegistry();

    const first = await registry.probeAll();
    const second = await registry.probeAll();

    expect(probeState.probeCommand).toHaveBeenCalledTimes(registry.getRegisteredTools().length);
    expect(second).toEqual(first);
  });

  it('re-probes when force=true and updates cache', async () => {
    probeState.probeCommand
      .mockResolvedValueOnce(available('/bin/old', '1.0.0'))
      .mockResolvedValue(available('/bin/new', '2.0.0'));
    const registry = new ToolRegistry();

    await registry.probeAll();
    const forced = await registry.probeAll(true);

    expect(probeState.probeCommand).toHaveBeenCalledTimes(registry.getRegisteredTools().length * 2);
    expect(forced['wabt.wasm2wat'].path).toBe('/bin/new');
  });

  it('exposes cached probe result for specific tool', async () => {
    probeState.probeCommand.mockResolvedValue(available('/usr/local/bin/tool', '3.1.4'));
    const registry = new ToolRegistry();

    await registry.probeAll(true);
    const cached = registry.getCachedProbe('runtime.wasmer');

    expect(cached).toMatchObject({
      available: true,
      path: '/usr/local/bin/tool',
      version: '3.1.4',
    });
  });

  it('a rejecting probe does not fail the whole batch — it degrades to unavailable', async () => {
    probeState.probeCommand
      .mockRejectedValueOnce(new Error('EPERM: operation not permitted'))
      .mockResolvedValue(available());

    const registry = new ToolRegistry();
    const results = await registry.probeAll(true);

    // The rejecting probe is reported as unavailable with the error surfaced…
    const failed = Object.entries(results).find(([, r]) => r.available === false);
    expect(failed).toBeDefined();
    expect(failed![1].reason).toContain('EPERM');
    // …while every other tool still resolved normally.
    expect(Object.values(results).filter((r) => r.available).length).toBe(
      registry.getRegisteredTools().length - 1,
    );
  });

  it('caches partial-failure results within the TTL — no full re-probe on the next call', async () => {
    probeState.probeCommand.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(available());
    const registry = new ToolRegistry();

    await registry.probeAll(true);
    const callCount = probeState.probeCommand.mock.calls.length;

    // Cache is now valid (even though one probe failed), so an unforced call
    // reuses the previous results instead of re-probing everything.
    const second = await registry.probeAll();
    expect(probeState.probeCommand.mock.calls.length).toBe(callCount);

    // The failed tool's degradation is visible through the cache too.
    const failed = registry
      .getRegisteredTools()
      .map((name) => registry.getCachedProbe(name))
      .find((r) => r && r.available === false);
    expect(failed?.reason).toContain('boom');
    expect(second).toBeDefined();
  });

  it('shares probe results across separate registry instances within the TTL', async () => {
    probeState.probeCommand.mockResolvedValue(available());
    const firstRegistry = new ToolRegistry();
    const secondRegistry = new ToolRegistry();

    const first = await firstRegistry.probeAll();
    const callsAfterFirst = probeState.probeCommand.mock.calls.length;
    const second = await secondRegistry.probeAll();

    // Second instance reuses the first instance's process-wide cache: no extra probes.
    expect(probeState.probeCommand).toHaveBeenCalledTimes(callsAfterFirst);
    expect(second).toEqual(first);
    expect(secondRegistry.getCachedProbe('wabt.wasm2wat')).toMatchObject({ available: true });
  });
});
