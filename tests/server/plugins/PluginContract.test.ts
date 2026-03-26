import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ExtensionBuilder: {},
  createExtension: vi.fn(() => ({ id: 'plugin' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
