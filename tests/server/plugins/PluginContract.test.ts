import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ExtensionBuilder: class ExtensionBuilder {},
  createExtension: vi.fn(() => ({ id: 'plugin' })),
}));

vi.mock('@jshookmcp/extension-sdk/plugin', () => ({
  ExtensionBuilder: state.ExtensionBuilder,
  createExtension: state.createExtension,
}));

describe('plugins/PluginContract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('re-exports runtime SDK symbols', async () => {
    const mod = await import('@server/plugins/PluginContract');

    expect(mod.ExtensionBuilder).toBe(state.ExtensionBuilder);
    expect(mod.createExtension).toBe(state.createExtension);
    expect(mod.createExtension('plugin', '1.0.0')).toEqual({ id: 'plugin' });
  });
});
