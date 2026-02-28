import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from './ToolProbe.js';

const probeState = vi.hoisted(() => ({
  probeCommand: vi.fn(),
}));

vi.mock('./ToolProbe.js', () => ({
  probeCommand: probeState.probeCommand,
}));

import { ToolRegistry } from './ToolRegistry.js';

function available(path = '/bin/tool', version = '1.0.0'): ProbeResult {
  return { available: true, path, version };
}

describe('ToolRegistry', () => {
  beforeEach(() => {
    probeState.probeCommand.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    expect(probeState.probeCommand).toHaveBeenCalledTimes(
      registry.getRegisteredTools().length * 2
    );
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
});
