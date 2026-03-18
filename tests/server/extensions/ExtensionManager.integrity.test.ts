import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const digest = vi.fn(() => 'abc123');
  const update = vi.fn(() => ({ digest }));
  const createHash = vi.fn(() => ({ update }));
  return {
    readFile: vi.fn(),
    createHash,
    update,
    digest,
    isCompatibleVersion: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: state.readFile,
}));

vi.mock('node:crypto', () => ({
  createHash: state.createHash,
}));

vi.mock('@server/extensions/ExtensionManager.version', () => ({
  isCompatibleVersion: state.isCompatibleVersion,
}));

describe('ExtensionManager.integrity', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    state.readFile.mockReset();
    state.createHash.mockClear();
    state.update.mockClear();
    state.digest.mockClear();
    state.isCompatibleVersion.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('hashes plugin file content as sha256 hex', async () => {
    state.readFile.mockResolvedValue(Buffer.from('plugin'));
    const { sha256Hex } = await import('@server/extensions/ExtensionManager.integrity');

    await expect(sha256Hex('/tmp/plugin.js')).resolves.toBe('abc123');
    expect(state.createHash).toHaveBeenCalledWith('sha256');
    expect(state.update).toHaveBeenCalledWith(Buffer.from('plugin'));
    expect(state.digest).toHaveBeenCalledWith('hex');
  });

  it('normalizes hex digests and parses allowlists', async () => {
    const { normalizeHex, parseDigestAllowlist } =
      await import('@server/extensions/ExtensionManager.integrity');

    expect(normalizeHex(' 0xABCDEF ')).toBe('abcdef');
    expect(parseDigestAllowlist(' 0xABC , def ,, abc ')).toEqual(new Set(['abc', 'def']));
    expect(parseDigestAllowlist('')).toEqual(new Set());
  });

  it('derives signature and strict-load flags from env and production defaults', async () => {
    const { isPluginSignatureRequired, isPluginStrictLoad } =
      await import('@server/extensions/ExtensionManager.integrity');

    process.env.NODE_ENV = 'production';
    delete process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
    delete process.env.MCP_PLUGIN_STRICT_LOAD;
    expect(isPluginSignatureRequired()).toBe(true);
    expect(isPluginStrictLoad()).toBe(true);

    process.env.MCP_PLUGIN_SIGNATURE_REQUIRED = 'false';
    process.env.MCP_PLUGIN_STRICT_LOAD = '0';
    expect(isPluginSignatureRequired()).toBe(false);
    expect(isPluginStrictLoad()).toBe(false);

    process.env.MCP_PLUGIN_SIGNATURE_REQUIRED = 'true';
    process.env.MCP_PLUGIN_STRICT_LOAD = 'false';
    expect(isPluginStrictLoad()).toBe(true);
  });

  it('reports plugin incompatibility from version checks', async () => {
    state.isCompatibleVersion.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { verifyPluginIntegrity } = await import('@server/extensions/ExtensionManager.integrity');

    const plugin = {
      id: 'sample-plugin',
      getCompatibleCore: '^2.0.0',
    };

    await expect(verifyPluginIntegrity(plugin as never, '1.0.0')).resolves.toEqual({
      ok: false,
      errors: ['Plugin sample-plugin incompatible with core 1.0.0; requires ^2.0.0'],
      warnings: [],
    });

    await expect(verifyPluginIntegrity(plugin as never, '2.1.0')).resolves.toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });
});
