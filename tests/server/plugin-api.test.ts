import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPluginBooleanConfig: vi.fn(() => true),
  getPluginBoostTier: vi.fn(() => 'workflow'),
  loadPluginEnv: vi.fn(),
}));

vi.mock('@server/extensions/plugin-config', () => ({
  getPluginBooleanConfig: state.getPluginBooleanConfig,
  getPluginBoostTier: state.getPluginBoostTier,
}));

vi.mock('@server/extensions/plugin-env', () => ({
  loadPluginEnv: state.loadPluginEnv,
}));

describe('plugin-api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('re-exports the plugin runtime helpers', async () => {
    const mod = await import('@server/plugin-api');

    expect(mod.getPluginBooleanConfig).toBe(state.getPluginBooleanConfig);
    expect(mod.getPluginBoostTier).toBe(state.getPluginBoostTier);
    expect(mod.loadPluginEnv).toBe(state.loadPluginEnv);
    expect(mod.getPluginBooleanConfig({} as never, 'plugin', 'flag', false)).toBe(true);
    expect(mod.getPluginBoostTier('plugin')).toBe('workflow');
    mod.loadPluginEnv('file:///plugin/manifest.ts');
    expect(state.loadPluginEnv).toHaveBeenCalledWith('file:///plugin/manifest.ts');
  });
});
