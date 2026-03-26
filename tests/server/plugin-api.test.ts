import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPluginBooleanConfig: vi.fn(() => true),
  getPluginBoostTier: vi.fn(() => 'workflow'),
  loadPluginEnv: vi.fn(),
  createExtension: vi.fn(),
  jsonResponse: vi.fn(),
  errorResponse: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/plugin-config', () => ({
  getPluginBooleanConfig: state.getPluginBooleanConfig,
  getPluginBoostTier: state.getPluginBoostTier,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/extensions/plugin-env', () => ({
  loadPluginEnv: state.loadPluginEnv,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/plugins/PluginContract', () => ({
  createExtension: state.createExtension,
  jsonResponse: state.jsonResponse,
  errorResponse: state.errorResponse,
  ExtensionBuilder: {},
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

  it('re-exports the extension builder API', async () => {
    const mod = await import('@server/plugin-api');

    expect(mod.createExtension).toBe(state.createExtension);
    expect(mod.jsonResponse).toBe(state.jsonResponse);
    expect(mod.errorResponse).toBe(state.errorResponse);
  });
});
