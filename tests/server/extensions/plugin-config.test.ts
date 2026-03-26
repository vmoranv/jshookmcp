import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPluginBooleanConfig, getPluginBoostTier } from '@server/extensions/plugin-config';

describe('plugin-config', () => {
  const originalEnv = { ...process.env };
  const ctx = {
    getConfig: vi.fn(),
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    ctx.getConfig.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers plugin-scoped env booleans over config values', () => {
    process.env.PLUGIN_IDA_BRIDGE_FEATURE_FLAG = 'yes';
    ctx.getConfig.mockReturnValue(false);

    expect(getPluginBooleanConfig(ctx as never, 'ida-bridge', 'feature flag', false)).toBe(true);
    expect(ctx.getConfig).not.toHaveBeenCalled();
  });

  it('falls back to context config when env boolean is invalid', () => {
    process.env.PLUGINS_IDA_BRIDGE_FEATURE_FLAG = 'maybe';
    ctx.getConfig.mockReturnValue(true);

    expect(getPluginBooleanConfig(ctx as never, 'ida-bridge', 'feature flag', false)).toBe(true);
    expect(ctx.getConfig).toHaveBeenCalledWith('plugins.ida-bridge.feature flag', false);
  });

  it('supports false-like env boolean values', () => {
    process.env.PLUGINS_IDA_BRIDGE_FEATURE_FLAG = 'off';

    expect(getPluginBooleanConfig(ctx as never, 'ida-bridge', 'feature flag', true)).toBe(false);
  });

  it('resolves boost tier from plugin env, global env, or fallback', () => {
    process.env.PLUGIN_IDA_BRIDGE_BOOST_DOMAIN = 'workflow';
    expect(getPluginBoostTier('ida-bridge')).toBe('workflow');

    delete process.env.PLUGIN_IDA_BRIDGE_BOOST_DOMAIN;
    process.env.MCP_DEFAULT_PLUGIN_BOOST_TIER = 'search';
    expect(getPluginBoostTier('ida-bridge')).toBe('search');

    process.env.MCP_DEFAULT_PLUGIN_BOOST_TIER = 'invalid';
    expect(getPluginBoostTier('ida-bridge')).toBe('full');
  });
});
